import { useState } from 'react';
import { deleteRow, upsertRow, type StoreData } from '../lib/api';
import type { TimeOff, TimeOffStatus } from '../lib/types';
import { fmtDate, fmtTime, fullName, todayLocal, toDbTime, toInputTime } from '../lib/format';

interface Props { data: StoreData; reload: () => Promise<void> }

export default function TimeOffPage({ data, reload }: Props) {
  const [showPast, setShowPast] = useState(false);
  const today = todayLocal();
  const active = data.employees.filter(e => e.active);
  const [draft, setDraft] = useState<TimeOff>({
    employee_id: active[0]?.id ?? '', start_date: today, end_date: today,
    start_time: null, end_time: null, status: 'approved', reason: '',
  });
  const [partial, setPartial] = useState(false);
  const [err, setErr] = useState('');
  const nameOf = (id: string) => { const e = data.employees.find(x => x.id === id); return e ? fullName(e) : '?'; };

  const rows = data.timeOff
    .filter(t => showPast || t.end_date >= today)
    .sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || a.start_date.localeCompare(b.start_date));

  async function act(fn: () => Promise<void>) {
    try { await fn(); await reload(); setErr(''); } catch (e) { setErr((e as Error).message); }
  }
  const setStatus = (t: TimeOff, status: TimeOffStatus) => act(() => upsertRow('time_off', { ...t, status }));

  return (
    <section>
      <div className="toolbar">
        <h2>Time off</h2>
        <span className="spacer" />
        <label className="check"><input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} /> show past</label>
      </div>
      {err && <div className="banner error">{err}</div>}

      <div className="card add-card">
        <h4>Add time off</h4>
        <div className="row add">
          <select value={draft.employee_id} onChange={e => setDraft({ ...draft, employee_id: e.target.value })}>
            {active.map(e => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
          </select>
          <label>From<input type="date" value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value, end_date: e.target.value > draft.end_date ? e.target.value : draft.end_date })} /></label>
          <label>To<input type="date" value={draft.end_date} min={draft.start_date} onChange={e => setDraft({ ...draft, end_date: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={partial} onChange={e => {
            setPartial(e.target.checked);
            setDraft({ ...draft, start_time: e.target.checked ? '09:00:00' : null, end_time: e.target.checked ? '12:00:00' : null });
          }} /> part of day</label>
          {partial && <>
            <input type="time" value={toInputTime(draft.start_time)} onChange={e => setDraft({ ...draft, start_time: toDbTime(e.target.value) })} />
            <input type="time" value={toInputTime(draft.end_time)} onChange={e => setDraft({ ...draft, end_time: toDbTime(e.target.value) })} />
          </>}
          <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as TimeOffStatus })}>
            <option value="approved">approved</option><option value="pending">pending</option>
          </select>
          <input placeholder="reason" value={draft.reason ?? ''} onChange={e => setDraft({ ...draft, reason: e.target.value })} />
          <button className="primary" onClick={() => act(() => upsertRow('time_off', draft))}>Add</button>
        </div>
      </div>

      <table className="table">
        <thead><tr><th>Employee</th><th>Dates</th><th>Time</th><th>Reason</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id}>
              <td>{nameOf(t.employee_id)}</td>
              <td>{fmtDate(t.start_date)}{t.end_date !== t.start_date && ` – ${fmtDate(t.end_date)}`}</td>
              <td>{t.start_time ? `${fmtTime(t.start_time)}–${fmtTime(t.end_time)}` : 'All day'}</td>
              <td className="muted">{t.reason}</td>
              <td><span className={`badge ${t.status}`}>{t.status}</span></td>
              <td className="actions">
                {t.status !== 'approved' && <button onClick={() => setStatus(t, 'approved')}>Approve</button>}
                {t.status !== 'denied' && <button onClick={() => setStatus(t, 'denied')}>Deny</button>}
                <button className="link danger" onClick={() => act(() => deleteRow('time_off', t.id!))}>✕</button>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">No time off.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
