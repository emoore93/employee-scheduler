import { useState } from 'react';
import { deleteRow, upsertRow, type StoreData } from '../lib/api';
import type { StaffingRequirement, StoreHourException, StoreHours } from '../lib/types';
import { DAY_NAMES, DAY_ORDER, fmtDate, fmtTime, todayLocal, toDbTime, toInputTime } from '../lib/format';

interface Props { storeId: string; data: StoreData; reload: () => Promise<void> }

export default function StorePage({ storeId, data, reload }: Props) {
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<void>) => {
    try { await fn(); await reload(); setErr(''); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <section className="store-setup">
      {err && <div className="banner error">{err}</div>}
      <div className="cols">
        <HoursEditor storeId={storeId} hours={data.storeHours} act={act} />
        <ExceptionsEditor storeId={storeId} rows={data.exceptions} act={act} />
      </div>
      <RequirementsEditor storeId={storeId} rows={data.requirements} act={act} />
    </section>
  );
}

type Act = (fn: () => Promise<void>) => Promise<void>;

function HoursEditor({ storeId, hours, act }: { storeId: string; hours: StoreHours[]; act: Act }) {
  const initial = DAY_ORDER.map(d => hours.find(h => h.day_of_week === d) ??
    { store_id: storeId, day_of_week: d, is_closed: true, open_time: null, close_time: null });
  const [rows, setRows] = useState<StoreHours[]>(initial);
  const set = (i: number, p: Partial<StoreHours>) => setRows(r => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="card">
      <h3>Weekly hours</h3>
      <table className="table compact">
        <tbody>
          {rows.map((h, i) => (
            <tr key={h.day_of_week}>
              <td>{DAY_NAMES[h.day_of_week]}</td>
              <td><label className="check"><input type="checkbox" checked={!h.is_closed} onChange={e => set(i, {
                is_closed: !e.target.checked,
                open_time: e.target.checked ? (h.open_time ?? '09:00:00') : null,
                close_time: e.target.checked ? (h.close_time ?? '17:00:00') : null,
              })} /> open</label></td>
              <td>{!h.is_closed && <input type="time" value={toInputTime(h.open_time)} onChange={e => set(i, { open_time: toDbTime(e.target.value) })} />}</td>
              <td>{!h.is_closed && <input type="time" value={toInputTime(h.close_time)} onChange={e => set(i, { close_time: toDbTime(e.target.value) })} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row end">
        <button className="primary" onClick={() => act(async () => { for (const r of rows) await upsertRow('store_hours', r); })}>Save hours</button>
      </div>
    </div>
  );
}

function ExceptionsEditor({ storeId, rows, act }: { storeId: string; rows: StoreHourException[]; act: Act }) {
  const [d, setD] = useState<StoreHourException>({ store_id: storeId, date: todayLocal(), is_closed: true, open_time: null, close_time: null, reason: '' });
  return (
    <div className="card">
      <h3>Holidays &amp; special hours</h3>
      <table className="table compact">
        <tbody>
          {rows.filter(r => r.date >= todayLocal()).map(r => (
            <tr key={r.id}>
              <td>{fmtDate(r.date)}</td>
              <td>{r.is_closed ? 'Closed' : `${fmtTime(r.open_time)}–${fmtTime(r.close_time)}`}</td>
              <td className="muted">{r.reason}</td>
              <td><button className="link danger" onClick={() => act(() => deleteRow('store_hour_exceptions', r.id!))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row add">
        <input type="date" value={d.date} onChange={e => setD({ ...d, date: e.target.value })} />
        <label className="check"><input type="checkbox" checked={d.is_closed} onChange={e => setD({ ...d, is_closed: e.target.checked, open_time: e.target.checked ? null : '09:00:00', close_time: e.target.checked ? null : '17:00:00' })} /> closed</label>
        {!d.is_closed && <>
          <input type="time" value={toInputTime(d.open_time)} onChange={e => setD({ ...d, open_time: toDbTime(e.target.value) })} />
          <input type="time" value={toInputTime(d.close_time)} onChange={e => setD({ ...d, close_time: toDbTime(e.target.value) })} />
        </>}
        <input placeholder="reason" value={d.reason ?? ''} onChange={e => setD({ ...d, reason: e.target.value })} />
        <button onClick={() => act(() => upsertRow('store_hour_exceptions', d))}>Add</button>
      </div>
    </div>
  );
}

function RequirementsEditor({ storeId, rows, act }: { storeId: string; rows: StaffingRequirement[]; act: Act }) {
  const [d, setD] = useState<StaffingRequirement>({ store_id: storeId, day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00', min_staff: 2, role: null });
  const copyDay = (from: number, to: number[]) => act(async () => {
    for (const t of to) {
      for (const r of rows.filter(x => x.day_of_week === t)) await deleteRow('staffing_requirements', r.id!);
      for (const r of rows.filter(x => x.day_of_week === from)) await upsertRow('staffing_requirements', { ...r, id: undefined, day_of_week: t });
    }
  });

  return (
    <div className="card">
      <h3>Staffing needs</h3>
      <p className="muted small">Headcount rows set how many people must be on the floor. Role rows (e.g. 1 shift lead) are minimums that count toward headcount.</p>
      <div className="req-grid">
        {DAY_ORDER.map(day => (
          <div key={day} className="req-day">
            <div className="req-head">
              <strong>{DAY_NAMES[day]}</strong>
              {day === 1 && <button className="link small" onClick={() => copyDay(1, [2, 3, 4])}>copy to Tue–Thu</button>}
            </div>
            {rows.filter(r => r.day_of_week === day).sort((a, b) => (a.role ?? '').localeCompare(b.role ?? '') || a.start_time.localeCompare(b.start_time)).map(r => (
              <div key={r.id} className="req-row">
                {fmtTime(r.start_time)}–{fmtTime(r.end_time)} · <b>{r.min_staff}</b> {r.role ? r.role.replace('_', ' ') : 'staff'}
                <button className="link danger" onClick={() => act(() => deleteRow('staffing_requirements', r.id!))}>✕</button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="row add">
        <select value={d.day_of_week} onChange={e => setD({ ...d, day_of_week: Number(e.target.value) })}>
          {DAY_ORDER.map(x => <option key={x} value={x}>{DAY_NAMES[x]}</option>)}
        </select>
        <input type="time" value={toInputTime(d.start_time)} onChange={e => setD({ ...d, start_time: toDbTime(e.target.value) })} />
        <input type="time" value={toInputTime(d.end_time)} onChange={e => setD({ ...d, end_time: toDbTime(e.target.value) })} />
        <input type="number" min={1} value={d.min_staff} onChange={e => setD({ ...d, min_staff: Number(e.target.value) })} style={{ width: 60 }} />
        <select value={d.role ?? ''} onChange={e => setD({ ...d, role: e.target.value || null })}>
          <option value="">staff (any role)</option><option value="shift_lead">shift lead</option><option value="manager">manager</option>
        </select>
        <button onClick={() => act(() => upsertRow('staffing_requirements', d))}>Add</button>
      </div>
    </div>
  );
}
