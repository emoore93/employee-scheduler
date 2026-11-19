/**
 * Auto-scheduler engine — pure TypeScript, no dependencies.
 * Runs in the browser (free: no server), in a Supabase Edge Function, or in Node.
 *
 * Hard rules (never broken by the generator):
 *   - store open hours (incl. holiday exceptions)
 *   - recurring availability / "unavailable" blocks (school, class, church…)
 *   - approved time off (and pending time off, unless respectPendingTimeOff=false)
 *   - 'never' conflicts: those two people never overlap
 *   - max hours/week, max days/week, min/max shift length, min rest between shifts
 *   - role needs are filled only by people holding that role
 *   - one shift per person per day
 *
 * Soft goals (scored):
 *   - fill coverage, most-constrained gaps first
 *   - favour 'preferred' windows
 *   - get people to their min hours, spread hours fairly
 *   - keep 'avoid' pairs apart
 *   - don't schedule hours nobody needs
 */
import type {
  Availability, Conflict, Employee, Shift, StaffingRequirement,
  StoreHourException, StoreHours, TimeOff,
} from './types';

export interface SchedulerOptions {
  slotMinutes: number;            // planning granularity
  minRestHours: number;           // between end of one shift and start of the next
  respectPendingTimeOff: boolean; // treat pending requests as blocked
  avoidPenalty: number;           // score penalty per overlapping hour with an 'avoid' partner
  breakMinutesOver6h: number;     // unpaid break added to shifts longer than 6h
  fillGaps: boolean;              // false = only analyse lockedShifts (coverage, gaps, issues)
}

export const DEFAULT_OPTIONS: SchedulerOptions = {
  slotMinutes: 30,
  minRestHours: 10,
  respectPendingTimeOff: true,
  avoidPenalty: 20,
  breakMinutesOver6h: 30,
  fillGaps: true,
};

export interface SchedulerInput {
  weekStart: string; // Monday, YYYY-MM-DD
  storeHours: StoreHours[];
  exceptions: StoreHourException[];
  requirements: StaffingRequirement[];
  employees: Employee[];
  availability: Availability[];
  timeOff: TimeOff[];
  conflicts: Conflict[];
  /** Shifts to keep as-is (e.g. manual edits); the generator fills around them. */
  lockedShifts?: Shift[];
  options?: Partial<SchedulerOptions>;
}

export interface CoverageGap {
  date: string;
  start: string;
  end: string;
  role: string | null; // null = total headcount
  needed: number;
  scheduled: number;
}

export interface ScheduleIssue {
  severity: 'error' | 'warning';
  message: string;
  employee_id?: string;
  shift_index?: number;
  date?: string;
}

export interface SchedulerResult {
  shifts: Shift[];
  gaps: CoverageGap[];
  issues: ScheduleIssue[];
  hours: Record<string, number>;
  stats: {
    demandHours: number;
    coveredHours: number;
    coveragePct: number;
    scheduledHours: number;
    laborCost: number;
  };
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  const v = h * 60 + (m || 0);
  return v >= 23 * 60 + 59 ? 1440 : v; // treat 23:59 as end of day
}
export function fromMin(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dowOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}
export function mondayOf(date: string): string {
  const dow = dowOf(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

export function paidMinutes(lengthMin: number, breakMin: number, opts = DEFAULT_OPTIONS) {
  return lengthMin - (breakMin ?? (lengthMin > 360 ? opts.breakMinutesOver6h : 0));
}

// ---------------------------------------------------------------------------
// Shared rule model (used by both the generator and the validator)
// ---------------------------------------------------------------------------
interface DayInfo { date: string; dow: number; closed: boolean; open: number; close: number }

export function buildRules(input: SchedulerInput) {
  const opts = { ...DEFAULT_OPTIONS, ...input.options };

  const days: DayInfo[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(input.weekStart, i);
    const dow = dowOf(date);
    const ex = input.exceptions.find(x => x.date === date);
    const base = input.storeHours.find(h => h.day_of_week === dow);
    const src = ex ?? base;
    const closed = !src || src.is_closed || !src.open_time || !src.close_time;
    days.push({
      date, dow, closed,
      open: closed ? 0 : toMin(src!.open_time!),
      close: closed ? 0 : toMin(src!.close_time!),
    });
  }

  const availByEmp = new Map<string, Availability[]>();
  for (const a of input.availability) {
    if (!availByEmp.has(a.employee_id)) availByEmp.set(a.employee_id, []);
    availByEmp.get(a.employee_id)!.push(a);
  }
  const timeOffByEmp = new Map<string, TimeOff[]>();
  for (const t of input.timeOff) {
    if (t.status === 'denied') continue;
    if (!timeOffByEmp.has(t.employee_id)) timeOffByEmp.set(t.employee_id, []);
    timeOffByEmp.get(t.employee_id)!.push(t);
  }
  const partners = new Map<string, { id: string; severity: 'never' | 'avoid' }[]>();
  for (const c of input.conflicts) {
    for (const [x, y] of [[c.employee_a, c.employee_b], [c.employee_b, c.employee_a]]) {
      if (!partners.has(x)) partners.set(x, []);
      partners.get(x)!.push({ id: y, severity: c.severity });
    }
  }

  /** Why an employee can't work [s,e) on a given day, or null if they can. */
  function unavailableReason(empId: string, day: DayInfo, s: number, e: number): string | null {
    if (day.closed) return 'store closed';
    if (s < day.open || e > day.close) return 'outside store hours';
    const rows = availByEmp.get(empId) ?? [];
    const positive = rows.filter(r => r.preference !== 'unavailable');
    if (positive.length) {
      const today = positive.filter(r => r.day_of_week === day.dow)
        .map(r => [toMin(r.start_time), toMin(r.end_time)]);
      for (let t = s; t < e; t += 5) {
        if (!today.some(([a, b]) => t >= a && t < b)) return 'outside their usual availability';
      }
    }
    for (const r of rows) {
      if (r.preference === 'unavailable' && r.day_of_week === day.dow &&
          overlaps(s, e, toMin(r.start_time), toMin(r.end_time))) {
        return `unavailable${r.note ? ` (${r.note})` : ''}`;
      }
    }
    return null;
  }

  function timeOffHit(empId: string, day: DayInfo, s: number, e: number): TimeOff | null {
    for (const t of timeOffByEmp.get(empId) ?? []) {
      if (day.date < t.start_date || day.date > t.end_date) continue;
      if (t.start_time && t.end_time && !overlaps(s, e, toMin(t.start_time), toMin(t.end_time))) continue;
      return t;
    }
    return null;
  }

  function isPreferred(empId: string, dow: number, s: number, e: number) {
    return (availByEmp.get(empId) ?? []).some(r =>
      r.preference === 'preferred' && r.day_of_week === dow &&
      s >= toMin(r.start_time) && e <= toMin(r.end_time));
  }

  return { opts, days, partners, unavailableReason, timeOffHit, isPreferred };
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
interface Seg { start: number; end: number; role: string | null; locked?: boolean; src?: Shift } // slot indexes
interface EmpState {
  e: Employee;
  avail: boolean[][];
  pref: boolean[][];
  segs: Seg[][];
  minutes: number;
}

export function generateSchedule(input: SchedulerInput): SchedulerResult {
  const R = buildRules(input);
  const { opts, days } = R;
  const SL = opts.slotMinutes;
  const NS = Math.ceil(1440 / SL);
  const openSlot = (d: DayInfo) => Math.ceil(d.open / SL);
  const closeSlot = (d: DayInfo) => Math.floor(d.close / SL);

  // ---- demand per slot ------------------------------------------------------
  const roles = [...new Set(input.requirements.filter(r => r.role).map(r => r.role!))].sort();
  const keys: (string | null)[] = [...roles, null]; // role needs first, then headcount
  const kIdx = (k: string | null) => (k === null ? roles.length : roles.indexOf(k));
  const demand: number[][][] = days.map(() => keys.map(() => new Array(NS).fill(0)));
  days.forEach((d, di) => {
    if (d.closed) return;
    for (const r of input.requirements) {
      if (r.day_of_week !== d.dow) continue;
      const a = Math.max(openSlot(d), Math.ceil(toMin(r.start_time) / SL));
      const b = Math.min(closeSlot(d), Math.floor(toMin(r.end_time) / SL));
      const arr = demand[di][kIdx(r.role)];
      for (let s = a; s < b; s++) arr[s] = Math.max(arr[s], r.min_staff);
    }
    // role needs count toward headcount
    const tot = demand[di][kIdx(null)];
    for (let s = 0; s < NS; s++) {
      const roleSum = roles.reduce((acc, r) => acc + demand[di][kIdx(r)][s], 0);
      tot[s] = Math.max(tot[s], roleSum);
    }
  });
  const cov: number[][][] = days.map(() => keys.map(() => new Array(NS).fill(0)));
  const deficit = (di: number, k: number, s: number) => demand[di][k][s] - cov[di][k][s];

  // ---- employee state -------------------------------------------------------
  const emps: EmpState[] = input.employees.filter(e => e.active).map(e => {
    const avail = days.map(() => new Array(NS).fill(false));
    const pref = days.map(() => new Array(NS).fill(false));
    days.forEach((d, di) => {
      if (d.closed) return;
      for (let s = openSlot(d); s < closeSlot(d); s++) {
        const a = s * SL, b = a + SL;
        if (R.unavailableReason(e.id, d, a, b)) continue;
        const to = R.timeOffHit(e.id, d, a, b);
        if (to && (to.status === 'approved' || opts.respectPendingTimeOff)) continue;
        avail[di][s] = true;
        pref[di][s] = R.isPreferred(e.id, d.dow, a, b);
      }
    });
    return { e, avail, pref, segs: days.map(() => []), minutes: 0 };
  });
  const byId = new Map(emps.map(x => [x.e.id, x]));

  const segPaid = (len: number) => paidMinutes(len * SL, len * SL > 360 ? opts.breakMinutesOver6h : 0, opts);

  function addSeg(st: EmpState, di: number, seg: Seg) {
    st.segs[di].push(seg);
    st.minutes += segPaid(seg.end - seg.start);
    for (let s = seg.start; s < seg.end; s++) {
      cov[di][kIdx(null)][s]++;
      for (const r of st.e.roles) if (roles.includes(r)) cov[di][kIdx(r)][s]++;
    }
  }
  function removeSeg(st: EmpState, di: number, seg: Seg) {
    st.segs[di] = st.segs[di].filter(x => x !== seg);
    st.minutes -= segPaid(seg.end - seg.start);
    for (let s = seg.start; s < seg.end; s++) {
      cov[di][kIdx(null)][s]--;
      for (const r of st.e.roles) if (roles.includes(r)) cov[di][kIdx(r)][s]--;
    }
  }

  // ---- locked shifts ------------------------------------------------------
  for (const sh of input.lockedShifts ?? []) {
    const st = byId.get(sh.employee_id);
    const di = days.findIndex(d => d.date === sh.shift_date);
    if (!st || di < 0) continue;
    addSeg(st, di, {
      start: Math.floor(toMin(sh.start_time) / SL), end: Math.ceil(toMin(sh.end_time) / SL),
      role: sh.role, locked: true, src: sh,
    });
  }

  const daysWorked = (st: EmpState) => st.segs.filter(x => x.length).length;
  const minLen = (e: Employee) => Math.ceil((e.min_shift_hours * 60) / SL);
  const maxLenFor = (st: EmpState) => {
    let len = Math.floor((st.e.max_shift_hours * 60) / SL);
    const remaining = st.e.max_hours_week * 60 - st.minutes;
    while (len > 0 && segPaid(len) > remaining) len--;
    return len;
  };

  /** Hard-rule check for placing a new shift [start,end) on day di. */
  function canPlace(st: EmpState, di: number, start: number, end: number): boolean {
    const e = st.e;
    const len = end - start;
    if (len < minLen(e) || len > maxLenFor(st)) return false;
    if (st.segs[di].length || daysWorked(st) >= e.max_days_week) return false;
    for (let s = start; s < end; s++) if (!st.avail[di][s]) return false;
    const rest = opts.minRestHours * 60;
    const prev = st.segs[di - 1]?.reduce((m, x) => Math.max(m, x.end), -1) ?? -1;
    if (prev >= 0 && 1440 - prev * SL + start * SL < rest) return false;
    const next = st.segs[di + 1]?.reduce((m, x) => Math.min(m, x.start), NS) ?? NS;
    if (next < NS && 1440 - end * SL + next * SL < rest) return false;
    for (const p of R.partners.get(e.id) ?? []) {
      if (p.severity !== 'never') continue;
      const other = byId.get(p.id);
      if (other?.segs[di].some(x => overlaps(start, end, x.start, x.end))) return false;
    }
    return true;
  }

  /** Hours of overlap with 'avoid' partners. */
  function avoidOverlaps(st: EmpState, di: number, start: number, end: number) {
    let slots = 0;
    for (const p of R.partners.get(st.e.id) ?? []) {
      if (p.severity !== 'avoid') continue;
      for (const x of byId.get(p.id)?.segs[di] ?? []) {
        slots += Math.max(0, Math.min(end, x.end) - Math.max(start, x.start));
      }
    }
    return (slots * SL) / 60;
  }

  interface Cand { st: EmpState; start: number; end: number; score: number }

  function candidates(di: number, s: number, k: number): Cand[] {
    const d = days[di];
    const role = keys[k];
    const out: Cand[] = [];
    const tot = kIdx(null);
    for (const st of emps) {
      const e = st.e;
      if (role && !e.roles.includes(role)) continue;
      if (st.segs[di].length || daysWorked(st) >= e.max_days_week) continue;
      if (!st.avail[di][s]) continue;
      let aS = s; while (aS - 1 >= openSlot(d) && st.avail[di][aS - 1]) aS--;
      let aE = s + 1; while (aE < closeSlot(d) && st.avail[di][aE]) aE++;
      const mn = minLen(e), mx = maxLenFor(st);
      if (mx < mn || aE - aS < mn) continue;
      let start: number, end: number;
      if (aE - s >= mn) { start = s; end = Math.min(aE, s + mx); }
      else { start = aE - mn; end = aE; }
      const useful = (x: number) => deficit(di, k, x) > 0 || deficit(di, tot, x) > 0;
      while (end - start > mn && !useful(end - 1)) end--;
      if (!canPlace(st, di, start, end)) {
        // try shortening to dodge a 'never' partner / rest rule
        let ok = false;
        for (let e2 = end - 1; e2 - start >= mn; e2--) if (canPlace(st, di, start, e2)) { end = e2; ok = true; break; }
        if (!ok) continue;
      }
      const len = end - start;
      let usefulKey = 0, usefulTot = 0, prefN = 0;
      for (let x = start; x < end; x++) {
        if (deficit(di, k, x) > 0) usefulKey++;
        else if (deficit(di, tot, x) > 0) usefulTot++;
        if (st.pref[di][x]) prefN++;
      }
      const hours = st.minutes / 60;
      let score = 10 * usefulKey + 3 * usefulTot - 2 * (len - usefulKey - usefulTot);
      score += 12 * (prefN / len);
      score += 4 * Math.max(0, e.min_hours_week - hours);
      score -= 15 * (hours / Math.max(1, e.max_hours_week));
      score -= opts.avoidPenalty * avoidOverlaps(st, di, start, end);
      if (!role && e.roles.includes('manager')) score -= 3; // keep managers for leadership needs
      out.push({ st, start, end, score });
    }
    out.sort((a, b) => b.score - a.score || a.st.e.last_name.localeCompare(b.st.e.last_name));
    return out;
  }

  // ---- main fill loop: most-constrained gap first --------------------------
  for (let k = 0; opts.fillGaps && k < keys.length; k++) {
    const dead = new Set<string>();
    for (let guard = 0; guard < 2000; guard++) {
      let best: { di: number; s: number; cands: Cand[]; def: number } | null = null;
      days.forEach((d, di) => {
        if (d.closed) return;
        for (let s = openSlot(d); s < closeSlot(d); s++) {
          const open = (x: number) => deficit(di, k, x) > 0 && !dead.has(`${di}:${x}`);
          if (!open(s) || (s > openSlot(d) && open(s - 1))) continue;
          const cands = candidates(di, s, k);
          if (!cands.length) { dead.add(`${di}:${s}`); continue; }
          const def = deficit(di, k, s);
          if (!best || cands.length < best.cands.length ||
              (cands.length === best.cands.length && def > best.def)) {
            best = { di, s, cands, def };
          }
        }
      });
      if (!best) break;
      const b = best as { di: number; s: number; cands: Cand[] };
      const c = b.cands[0];
      addSeg(c.st, b.di, { start: c.start, end: c.end, role: keys[k] });
    }
  }

  // ---- top-up: get people to their minimum hours ----------------------------
  const tot = kIdx(null);
  const under = () => emps.filter(st => st.minutes < st.e.min_hours_week * 60)
    .sort((a, b) => (a.minutes - a.e.min_hours_week * 60) - (b.minutes - b.e.min_hours_week * 60));
  for (const st of opts.fillGaps ? under() : []) {
    // 1) stretch existing shifts
    for (let di = 0; di < 7 && st.minutes < st.e.min_hours_week * 60; di++) {
      for (const seg of [...st.segs[di]]) {
        if (seg.locked) continue;
        let cur = seg;
        for (let grew = true; grew && st.minutes < st.e.min_hours_week * 60;) {
          grew = false;
          for (const [ns, ne] of [[cur.start, cur.end + 1], [cur.start - 1, cur.end]]) {
            if (ns < 0 || ne > NS) continue;
            removeSeg(st, di, cur);
            if (canPlace(st, di, ns, ne)) {
              cur = { ...cur, start: ns, end: ne }; addSeg(st, di, cur); grew = true; break;
            }
            addSeg(st, di, cur);
          }
        }
      }
    }
    // 2) add shifts on free days, at the busiest times
    while (st.minutes < st.e.min_hours_week * 60) {
      let best: { di: number; s: number; e: number; score: number } | null = null;
      const need = Math.ceil((st.e.min_hours_week * 60 - st.minutes) / SL);
      const len = Math.max(minLen(st.e), Math.min(maxLenFor(st), need));
      days.forEach((d, di) => {
        if (d.closed) return;
        for (let s = openSlot(d); s + len <= closeSlot(d); s++) {
          if (!canPlace(st, di, s, s + len)) continue;
          let score = 0;
          for (let x = s; x < s + len; x++) {
            score += (deficit(di, tot, x) > 0 ? 10 : 0) + demand[di][tot][x] - cov[di][tot][x] * 0.5;
            if (st.pref[di][x]) score += 2;
          }
          score -= opts.avoidPenalty * avoidOverlaps(st, di, s, s + len);
          if (!best || score > best.score) best = { di, s, e: s + len, score };
        }
      });
      if (!best) break;
      const b = best as { di: number; s: number; e: number };
      addSeg(st, b.di, { start: b.s, end: b.e, role: null });
    }
  }

  // ---- output ---------------------------------------------------------------
  const shifts: Shift[] = [];
  emps.forEach(st => st.segs.forEach((list, di) => list.forEach(seg => {
    if (seg.src) { shifts.push(seg.src); return; }
    const lenMin = (seg.end - seg.start) * SL;
    shifts.push({
      employee_id: st.e.id,
      shift_date: days[di].date,
      start_time: fromMin(seg.start * SL),
      end_time: fromMin(Math.min(1440, seg.end * SL)),
      role: seg.role ?? (st.e.roles.includes('associate') ? 'associate' : st.e.roles[0] ?? null),
      break_minutes: lenMin > 360 ? opts.breakMinutesOver6h : 0,
    });
  })));
  shifts.sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time));

  const gaps: CoverageGap[] = [];
  let demandSlots = 0, coveredSlots = 0;
  days.forEach((d, di) => {
    if (d.closed) return;
    keys.forEach((key, k) => {
      let run: CoverageGap | null = null;
      for (let s = openSlot(d); s <= closeSlot(d); s++) {
        const def = s < closeSlot(d) ? deficit(di, k, s) : 0;
        if (key === null && s < closeSlot(d)) {
          demandSlots += demand[di][k][s];
          coveredSlots += Math.min(demand[di][k][s], cov[di][k][s]);
        }
        if (def > 0) {
          if (!run) run = { date: d.date, start: fromMin(s * SL), end: '', role: key, needed: 0, scheduled: 99 };
          run.needed = Math.max(run.needed, demand[di][k][s]);
          run.scheduled = Math.min(run.scheduled, cov[di][k][s]);
        } else if (run) {
          run.end = fromMin(s * SL); gaps.push(run); run = null;
        }
      }
    });
  });

  const issues = validateShifts({ ...input, options: opts }, shifts);
  const hours: Record<string, number> = {};
  let cost = 0, totalMin = 0;
  for (const st of emps) {
    hours[st.e.id] = Math.round((st.minutes / 60) * 100) / 100;
    cost += (st.minutes / 60) * (st.e.hourly_rate ?? 0);
    totalMin += st.minutes;
  }
  return {
    shifts, gaps, issues, hours,
    stats: {
      demandHours: (demandSlots * SL) / 60,
      coveredHours: (coveredSlots * SL) / 60,
      coveragePct: demandSlots ? Math.round((coveredSlots / demandSlots) * 1000) / 10 : 100,
      scheduledHours: Math.round((totalMin / 60) * 10) / 10,
      laborCost: Math.round(cost * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Validator — checks any set of shifts (generated or hand-edited)
// ---------------------------------------------------------------------------
export function validateShifts(input: SchedulerInput, shifts: Shift[]): ScheduleIssue[] {
  const R = buildRules(input);
  const { opts, days } = R;
  const issues: ScheduleIssue[] = [];
  const emp = new Map(input.employees.map(e => [e.id, e]));
  const name = (id: string) => { const e = emp.get(id); return e ? `${e.first_name} ${e.last_name}` : 'Unknown'; };
  const dayOf = (date: string) => days.find(d => d.date === date);

  shifts.forEach((sh, i) => {
    const e = emp.get(sh.employee_id);
    const d = dayOf(sh.shift_date);
    if (!e || !d) return;
    const s = toMin(sh.start_time), en = toMin(sh.end_time);
    const base = { employee_id: e.id, shift_index: i, date: sh.shift_date };
    const why = R.unavailableReason(e.id, d, s, en);
    if (why) issues.push({ ...base, severity: why.startsWith('store') || why.startsWith('outside store') ? 'error' : 'warning', message: `${name(e.id)} ${sh.shift_date}: ${why}` });
    const to = R.timeOffHit(e.id, d, s, en);
    if (to) issues.push({ ...base, severity: to.status === 'approved' ? 'error' : 'warning', message: `${name(e.id)} has ${to.status} time off on ${sh.shift_date}${to.reason ? ` (${to.reason})` : ''}` });
    const len = (en - s) / 60;
    if (len < e.min_shift_hours) issues.push({ ...base, severity: 'warning', message: `${name(e.id)} ${sh.shift_date}: shift shorter than their ${e.min_shift_hours}h minimum` });
    if (len > e.max_shift_hours) issues.push({ ...base, severity: 'warning', message: `${name(e.id)} ${sh.shift_date}: shift longer than their ${e.max_shift_hours}h maximum` });
    if (sh.role && !e.roles.includes(sh.role)) issues.push({ ...base, severity: 'warning', message: `${name(e.id)} isn't set up for role "${sh.role}"` });
  });

  // pairwise conflicts
  const seen = new Set<string>();
  for (const c of input.conflicts) {
    const a = shifts.map((x, i) => [x, i] as const).filter(([x]) => x.employee_id === c.employee_a);
    const b = shifts.filter(x => x.employee_id === c.employee_b);
    for (const [x, i] of a) for (const y of b) {
      if (x.shift_date !== y.shift_date) continue;
      if (!overlaps(toMin(x.start_time), toMin(x.end_time), toMin(y.start_time), toMin(y.end_time))) continue;
      const key = `${c.employee_a}|${c.employee_b}|${x.shift_date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        severity: c.severity === 'never' ? 'error' : 'warning', employee_id: c.employee_a, shift_index: i, date: x.shift_date,
        message: `${name(c.employee_a)} and ${name(c.employee_b)} overlap on ${x.shift_date}${c.severity === 'never' ? ' (must not work together)' : ' (try to keep apart)'}`,
      });
    }
  }

  // per-employee weekly rules
  for (const e of input.employees.filter(x => x.active)) {
    const mine = shifts.filter(x => x.employee_id === e.id).sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time));
    const minutes = mine.reduce((m, x) => {
      const len = toMin(x.end_time) - toMin(x.start_time);
      return m + len - (x.break_minutes ?? 0);
    }, 0);
    const h = minutes / 60;
    if (h > e.max_hours_week) issues.push({ severity: 'error', employee_id: e.id, message: `${name(e.id)} is over their ${e.max_hours_week}h weekly max (${h.toFixed(1)}h)` });
    if (h < e.min_hours_week) issues.push({ severity: 'warning', employee_id: e.id, message: `${name(e.id)} is under their ${e.min_hours_week}h weekly target (${h.toFixed(1)}h)` });
    const dates = new Set(mine.map(x => x.shift_date));
    if (dates.size > e.max_days_week) issues.push({ severity: 'warning', employee_id: e.id, message: `${name(e.id)} works ${dates.size} days (max ${e.max_days_week})` });
    if (dates.size < mine.length) issues.push({ severity: 'warning', employee_id: e.id, message: `${name(e.id)} has more than one shift on a day` });
    for (let i = 1; i < mine.length; i++) {
      const p = mine[i - 1], c = mine[i];
      const dayGap = (Date.parse(c.shift_date) - Date.parse(p.shift_date)) / 86400000;
      const restMin = dayGap * 1440 + toMin(c.start_time) - toMin(p.end_time);
      if (restMin >= 0 && restMin < opts.minRestHours * 60) issues.push({ severity: 'warning', employee_id: e.id, date: c.shift_date, message: `${name(e.id)} has only ${(restMin / 60).toFixed(1)}h rest before ${c.shift_date}` });
    }
  }
  return issues;
}

/** Coverage, gaps, hours and rule issues for an existing set of shifts (no generation). */
export function analyzeSchedule(input: SchedulerInput, shifts: Shift[]): SchedulerResult {
  const r = generateSchedule({ ...input, lockedShifts: shifts, options: { ...input.options, fillGaps: false } });
  return { ...r, shifts };
}
