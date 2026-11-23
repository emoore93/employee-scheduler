import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteShift, ensureSchedule, getSchedule, loadShifts, replaceShifts, saveShift,
  setScheduleStatus, toSchedulerInput, weekDates, type StoreData,
} from '../lib/api';
import {
  addDays, analyzeSchedule, buildRules, generateSchedule, mondayOf, type SchedulerResult,
} from '../lib/scheduler';
import type { Employee, Schedule, Shift } from '../lib/types';
import {
  fmtDate, fmtTime, fullName, money, shiftHours, todayLocal, toDbTime, toInputTime,
} from '../lib/format';

const ROLE_RANK = (e: Employee) =>
  e.roles.includes('manager') ? 0 : e.roles.includes('shift_lead') ? 1 : 2;

interface Props { storeId: string; storeName: string; data: StoreData; readOnly?: boolean }

export default function SchedulePage({ storeId, storeName, data, readOnly = false }: Props) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayLocal()));
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [lastRun, setLastRun] = useState<SchedulerResult | null>(null);
  const [keepExisting, setKeepExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const s = await getSchedule(storeId, weekStart);
      setSchedule(s);
      const visible = s && (!readOnly || s.status === 'published');
      setShifts(visible ? await loadShifts(s.id) : []);
    } catch (e) { setErr((e as Error).message); }
  }, [storeId, weekStart, readOnly]);

  useEffect(() => { load(); setLastRun(null); }, [load]);

  const input = useMemo(() => toSchedulerInput(data, weekStart), [data, weekStart]);
  const rules = useMemo(() => buildRules(input), [input]);
  const analysis = useMemo(() => analyzeSchedule(input, shifts), [input, shifts]);
  const dates = weekDates(weekStart);
  const employees = useMemo(
    () => data.employees.filter(e => e.active)
      .sort((a, b) => ROLE_RANK(a) - ROLE_RANK(b) || a.last_name.localeCompare(b.last_name)),
    [data.employees],
  );

  const issuesByShift = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const i of analysis.issues) {
      if (i.shift_index == null) continue;
      m.set(i.shift_index, [...(m.get(i.shift_index) ?? []), `${i.severity === 'error' ? '⛔' : '⚠️'} ${i.message}`]);
    }
    return m;
  }, [analysis]);

  const hoursFor = (id: string) => shifts.filter(s => s.employee_id === id).reduce((h, s) => h + shiftHours(s), 0);
  const totalHours = shifts.reduce((h, s) => h + shiftHours(s), 0);
  const laborCost = shifts.reduce((c, s) => {
    const e = data.employees.find(x => x.id === s.employee_id);
    return c + shiftHours(s) * (e?.hourly_rate ?? 0);
  }, 0);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr('');
    try { await fn(); await load(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const generate = () => run(async () => {
    if (shifts.length && !keepExisting &&
        !confirm('Replace all shifts this week with a newly generated schedule?')) return;
    const sch = await ensureSchedule(storeId, weekStart);
    const r = generateSchedule({ ...input, lockedShifts: keepExisting ? shifts : [] });
    await replaceShifts(sch.id, r.shifts);
    setLastRun(r);
  });

  const copyLastWeek = () => run(async () => {
    const prev = await getSchedule(storeId, addDays(weekStart, -7));
    if (!prev) throw new Error('No schedule found for last week.');
    const prevShifts = await loadShifts(prev.id);
    if (shifts.length && !confirm('Replace this week with a copy of last week?')) return;
    const sch = await ensureSchedule(storeId, weekStart);
    await replaceShifts(sch.id, prevShifts.map(s => ({ ...s, id: undefined, shift_date: addDays(s.shift_date, 7) })));
  });

  const clearWeek = () => run(async () => {
    if (!schedule || !confirm('Delete every shift this week?')) return;
    await replaceShifts(schedule.id, []);
    setLastRun(null);
  });

  const togglePublish = () => run(async () => {
    if (!schedule) return;
    const errors = analysis.issues.filter(i => i.severity === 'error');
    if (schedule.status === 'draft' && errors.length &&
        !confirm(`There are ${errors.length} rule violations. Publish anyway?`)) return;
    await setScheduleStatus(schedule.id, schedule.status === 'draft' ? 'published' : 'draft');
  });

  function cellNote(e: Employee, dayIdx: number): { text: string; cls: string } | null {
    const day = rules.days[dayIdx];
    if (day.closed) return { text: 'Closed', cls: 'closed' };
    const to = rules.timeOffHit(e.id, day, day.open, day.close);
    if (to && !to.start_time) {
      return { text: `${to.status === 'pending' ? 'Requested off' : 'Off'}${to.reason ? `: ${to.reason}` : ''}`, cls: to.status === 'pending' ? 'pending' : 'off' };
    }
    const rows = data.availability.filter(a => a.employee_id === e.id);
    const positive = rows.filter(a => a.preference !== 'unavailable');
    const today = positive.filter(a => a.day_of_week === day.dow);
    if (positive.length && !today.length) return { text: 'Not available', cls: 'off' };
    const allDayBlock = rows.find(a => a.preference === 'unavailable' && a.day_of_week === day.dow &&
      a.start_time <= '00:00:00' && a.end_time >= '23:59:00');
    if (allDayBlock) return { text: `Not available${allDayBlock.note ? `: ${allDayBlock.note}` : ''}`, cls: 'off' };
    if (today.length) return { text: today.map(a => `${fmtTime(a.start_time)}–${fmtTime(a.end_time)}`).join(', '), cls: 'avail' };
    return null;
  }

  const gapsByDate = (date: string) => analysis.gaps.filter(g => g.date === date);
  const errorCount = analysis.issues.filter(i => i.severity === 'error').length;

  return (
    <section>
      <div className="toolbar no-print">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
        <button onClick={() => setWeekStart(mondayOf(todayLocal()))}>This week</button>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
        <h2>Week of {fmtDate(weekStart, false)} – {fmtDate(addDays(weekStart, 6), false)}</h2>
        {schedule && <span className={`badge ${schedule.status}`}>{schedule.status}</span>}
        {readOnly && <span className="badge">view only</span>}
        <span className="spacer" />
        {!readOnly && <>
          <label className="check"><input type="checkbox" checked={keepExisting} onChange={e => setKeepExisting(e.target.checked)} /> keep current shifts</label>
          <button className="primary" disabled={busy} onClick={generate}>✨ Auto-schedule</button>
          <button disabled={busy} onClick={copyLastWeek}>Copy last week</button>
          <button disabled={busy || !schedule} onClick={togglePublish}>{schedule?.status === 'published' ? 'Unpublish' : 'Publish'}</button>
          <button disabled={busy || !shifts.length} onClick={clearWeek}>Clear</button>
        </>}
        <button onClick={() => window.print()}>Print</button>
      </div>
      <h2 className="print-only">{storeName} Schedule — week of {fmtDate(weekStart, false)}</h2>
      {err && <div className="banner error">{err}</div>}
      {readOnly && schedule?.status !== 'published' && (
        <div className="banner">This week’s schedule hasn’t been published yet.</div>
      )}

      {!readOnly && <div className="stats no-print">
        <Stat label="Coverage" value={`${analysis.stats.coveragePct}%`} warn={analysis.stats.coveragePct < 100} />
        <Stat label="Scheduled hours" value={totalHours.toFixed(1)} />
        <Stat label="Labor cost" value={money(laborCost)} />
        <Stat label="Rule violations" value={String(errorCount)} warn={errorCount > 0} />
        <Stat label="Warnings" value={String(analysis.issues.length - errorCount)} />
      </div>}

      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="emp-col">Employee</th>
              {dates.map((d, i) => <th key={d} className={rules.days[i].closed ? 'closed' : ''}>{fmtDate(d)}</th>)}
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(e => {
              const h = hoursFor(e.id);
              const hcls = h > e.max_hours_week ? 'over' : h < e.min_hours_week ? 'under' : 'ok';
              return (
                <tr key={e.id}>
                  <td className="emp-col">
                    <span className="dot" style={{ background: e.color ?? '#888' }} />
                    {fullName(e)}
                    <div className="sub">{e.roles.filter(r => r !== 'associate').join(', ') || 'associate'}</div>
                  </td>
                  {dates.map((d, di) => {
                    const mine = shifts.map((s, idx) => [s, idx] as const).filter(([s]) => s.employee_id === e.id && s.shift_date === d);
                    const note = cellNote(e, di);
                    return (
                      <td key={d} className={`cell ${note?.cls ?? ''} ${readOnly ? 'ro' : ''}`}
                          onClick={() => !readOnly && !rules.days[di].closed && setEditing({
                            employee_id: e.id, shift_date: d,
                            start_time: rules.days[di].open ? `${String(Math.floor(rules.days[di].open / 60)).padStart(2, '0')}:00:00` : '09:00:00',
                            end_time: '17:00:00', role: e.roles.includes('associate') ? 'associate' : e.roles[0], break_minutes: 30,
                          })}>
                        {mine.map(([s, idx]) => {
                          const iss = issuesByShift.get(idx);
                          const sev = readOnly ? '' : iss?.some(x => x.startsWith('⛔')) ? 'err' : iss ? 'warn' : '';
                          return (
                            <div key={s.id ?? idx} className={`chip ${sev}`} style={{ borderLeftColor: e.color ?? '#888' }}
                                 title={readOnly ? undefined : iss?.join('\n')}
                                 onClick={ev => { ev.stopPropagation(); if (!readOnly) setEditing(s); }}>
                              {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                              {s.role && s.role !== 'associate' && <span className="role">{s.role.replace('_', ' ')}</span>}
                            </div>
                          );
                        })}
                        {!mine.length && note && <div className="note-text">{note.text}</div>}
                      </td>
                    );
                  })}
                  <td className={`hours ${hcls}`} title={`target ${e.min_hours_week}–${e.max_hours_week}h`}>{h.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
          {!readOnly && <tfoot className="no-print">
            <tr>
              <td className="emp-col">Coverage</td>
              {dates.map((d, i) => {
                const gaps = gapsByDate(d);
                if (rules.days[i].closed) return <td key={d} className="closed">—</td>;
                return (
                  <td key={d} className={gaps.length ? 'gap' : 'covered'}>
                    {gaps.length ? gaps.map((g, j) => (
                      <div key={j}>{fmtTime(g.start)}–{fmtTime(g.end)}: {g.scheduled}/{g.needed}{g.role ? ` ${g.role.replace('_', ' ')}` : ''}</div>
                    )) : '✓'}
                  </td>
                );
              })}
              <td />
            </tr>
          </tfoot>}
        </table>
      </div>

      {!readOnly && analysis.issues.length > 0 && (
        <details className="issues no-print" open={errorCount > 0}>
          <summary>{analysis.issues.length} things to review</summary>
          <ul>
            {analysis.issues.map((i, k) => <li key={k} className={i.severity}>{i.message}</li>)}
          </ul>
        </details>
      )}
      {lastRun && (
        <p className="muted no-print">
          Last auto-schedule: {lastRun.shifts.length} shifts, {lastRun.stats.scheduledHours}h,
          {' '}{lastRun.stats.coveragePct}% of {lastRun.stats.demandHours} needed staff-hours covered.
        </p>
      )}

      {editing && (
        <ShiftEditor
          shift={editing}
          employees={employees}
          onClose={() => setEditing(null)}
          onSave={s => run(async () => {
            const sch = schedule ?? await ensureSchedule(storeId, weekStart);
            await saveShift({ ...s, schedule_id: sch.id });
            setEditing(null);
          })}
          onDelete={editing.id ? () => run(async () => { await deleteShift(editing.id!); setEditing(null); }) : undefined}
        />
      )}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div className={`stat ${warn ? 'warn' : ''}`}><div className="v">{value}</div><div className="l">{label}</div></div>;
}

function ShiftEditor({ shift, employees, onClose, onSave, onDelete }: {
  shift: Shift; employees: Employee[]; onClose: () => void;
  onSave: (s: Shift) => void; onDelete?: () => void;
}) {
  const [s, setS] = useState<Shift>(shift);
  const emp = employees.find(e => e.id === s.employee_id);
  const set = (patch: Partial<Shift>) => setS(prev => ({ ...prev, ...patch }));
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal card" onClick={e => e.stopPropagation()}
            onSubmit={e => { e.preventDefault(); onSave(s); }}>
        <h3>{shift.id ? 'Edit shift' : 'Add shift'} · {fmtDate(s.shift_date)}</h3>
        <label>Employee
          <select value={s.employee_id} onChange={e => set({ employee_id: e.target.value })}>
            {employees.map(e => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
        </label>
        <div className="row">
          <label>Start<input type="time" step={900} value={toInputTime(s.start_time)} onChange={e => set({ start_time: toDbTime(e.target.value) })} required /></label>
          <label>End<input type="time" step={900} value={toInputTime(s.end_time)} onChange={e => set({ end_time: toDbTime(e.target.value) })} required /></label>
          <label>Break (min)<input type="number" min={0} step={15} value={s.break_minutes ?? 0} onChange={e => set({ break_minutes: Number(e.target.value) })} /></label>
        </div>
        <label>Role
          <select value={s.role ?? ''} onChange={e => set({ role: e.target.value || null })}>
            {(emp?.roles ?? ['associate']).map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label>Notes<input value={s.notes ?? ''} onChange={e => set({ notes: e.target.value })} /></label>
        <div className="row end">
          {onDelete && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary">Save</button>
        </div>
      </form>
    </div>
  );
}
