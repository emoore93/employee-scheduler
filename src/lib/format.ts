export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first display

/** "13:30:00" -> "1:30p" */
export function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${suffix}` : `${hh}${suffix}`;
}

/** "2026-11-23" -> "Mon 11/23" */
export function fmtDate(d: string, withDay = true): string {
  const dt = new Date(d + 'T00:00:00Z');
  const md = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
  return withDay ? `${DAY_NAMES[dt.getUTCDay()]} ${md}` : md;
}

/** Local "today" as YYYY-MM-DD */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** <input type="time"> gives "HH:MM"; Postgres wants "HH:MM:SS" (either works, normalise) */
export const toDbTime = (t: string) => (t.length === 5 ? `${t}:00` : t);
export const toInputTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

export const fullName = (e: { first_name: string; last_name: string }) => `${e.first_name} ${e.last_name}`;

export function shiftHours(s: { start_time: string; end_time: string; break_minutes?: number }) {
  const [h1, m1] = s.start_time.split(':').map(Number);
  const [h2, m2] = s.end_time.split(':').map(Number);
  return (h2 * 60 + m2 - h1 * 60 - m1 - (s.break_minutes ?? 0)) / 60;
}

export const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
