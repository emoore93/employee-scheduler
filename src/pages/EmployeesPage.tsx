import { useState, type ChangeEvent } from 'react';
import { deleteRow, upsertRow, type StoreData } from '../lib/api';
import type { Availability, Conflict, Employee, Preference } from '../lib/types';
import { DAY_NAMES, DAY_ORDER, fmtTime, fullName, toDbTime, toInputTime } from '../lib/format';

const ALL_ROLES = ['manager', 'shift_lead', 'associate'];
const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#4f46e5', '#be123c', '#0d9488'];

interface Props { storeId: string; data: StoreData; reload: () => Promise<void> }

export default function EmployeesPage({ storeId, data, reload }: Props) {
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const list = data.employees.filter(e => showInactive || e.active);
  const emp = selected === 'new' ? null : data.employees.find(e => e.id === selected) ?? null;

  return (
    <section className="split">
      <div className="list">
        <div className="toolbar">
          <h2>Employees</h2>
          <span className="spacer" />
          <label className="check"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> show inactive</label>
          <button className="primary" onClick={() => setSelected('new')}>+ Add</button>
        </div>
        <table className="table">
          <thead><tr><th>Name</th><th>Roles</th><th>Hours/wk</th><th>Notes</th></tr></thead>
          <tbody>
            {list.map(e => (
              <tr key={e.id} className={`${selected === e.id ? 'sel' : ''} ${e.active ? '' : 'inactive'}`} onClick={() => setSelected(e.id)}>
                <td><span className="dot" style={{ background: e.color ?? '#888' }} />{fullName(e)}{e.is_minor && <span className="tag">minor</span>}</td>
                <td>{e.roles.join(', ')}</td>
                <td>{e.min_hours_week}–{e.max_hours_week}</td>
                <td className="muted">{e.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <EmployeeEditor key={selected} storeId={storeId} employee={emp} data={data}
          onSaved={async () => { await reload(); }} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}

function blankEmployee(storeId: string): Omit<Employee, 'id'> & { id?: string } {
  return {
    store_id: storeId, first_name: '', last_name: '', email: '', phone: '', roles: ['associate'],
    hourly_rate: 15, min_hours_week: 0, max_hours_week: 30, min_shift_hours: 3, max_shift_hours: 8,
    max_days_week: 5, is_minor: false, active: true,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)], notes: '',
  };
}

function EmployeeEditor({ storeId, employee, data, onSaved, onClose }: {
  storeId: string; employee: Employee | null; data: StoreData;
  onSaved: () => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<Omit<Employee, 'id'> & { id?: string }>(employee ?? blankEmployee(storeId));
  const [err, setErr] = useState('');
  const set = (p: Partial<Employee>) => setForm(f => ({ ...f, ...p }));
  const num = (k: keyof Employee) => (e: ChangeEvent<HTMLInputElement>) => set({ [k]: Number(e.target.value) } as Partial<Employee>);

  async function save() {
    try { await upsertRow('employees', { ...form, email: form.email || null }); await onSaved(); if (!employee) onClose(); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="editor card">
      <div className="toolbar"><h3>{employee ? fullName(employee) : 'New employee'}</h3><span className="spacer" /><button className="link" onClick={onClose}>Close</button></div>
      {err && <div className="banner error">{err}</div>}
      <div className="row">
        <label>First name<input value={form.first_name} onChange={e => set({ first_name: e.target.value })} /></label>
        <label>Last name<input value={form.last_name} onChange={e => set({ last_name: e.target.value })} /></label>
      </div>
      <div className="row">
        <label>Email<input type="email" value={form.email ?? ''} onChange={e => set({ email: e.target.value })} /></label>
        <label>Phone<input value={form.phone ?? ''} onChange={e => set({ phone: e.target.value })} /></label>
      </div>
      <fieldset>
        <legend>Roles</legend>
        {ALL_ROLES.map(r => (
          <label key={r} className="check">
            <input type="checkbox" checked={form.roles.includes(r)}
              onChange={e => set({ roles: e.target.checked ? [...form.roles, r] : form.roles.filter(x => x !== r) })} />
            {r.replace('_', ' ')}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <label>Min hrs/wk<input type="number" min={0} value={form.min_hours_week} onChange={num('min_hours_week')} /></label>
        <label>Max hrs/wk<input type="number" min={0} value={form.max_hours_week} onChange={num('max_hours_week')} /></label>
        <label>Max days/wk<input type="number" min={1} max={7} value={form.max_days_week} onChange={num('max_days_week')} /></label>
      </div>
      <div className="row">
        <label>Min shift (h)<input type="number" min={1} step={0.5} value={form.min_shift_hours} onChange={num('min_shift_hours')} /></label>
        <label>Max shift (h)<input type="number" min={1} step={0.5} value={form.max_shift_hours} onChange={num('max_shift_hours')} /></label>
        <label>Rate ($/h)<input type="number" min={0} step={0.25} value={form.hourly_rate ?? 0} onChange={num('hourly_rate')} /></label>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={form.is_minor} onChange={e => set({ is_minor: e.target.checked })} /> Minor</label>
        <label className="check"><input type="checkbox" checked={form.active} onChange={e => set({ active: e.target.checked })} /> Active</label>
        <label>Colour<input type="color" value={form.color ?? '#888888'} onChange={e => set({ color: e.target.value })} /></label>
      </div>
      <label>Notes<input value={form.notes ?? ''} onChange={e => set({ notes: e.target.value })} /></label>
      <div className="row end"><button className="primary" onClick={save}>Save</button></div>

      {employee && <AvailabilityEditor employee={employee} rows={data.availability.filter(a => a.employee_id === employee.id)} onChange={onSaved} />}
      {employee && <ConflictEditor employee={employee} data={data} onChange={onSaved} />}
    </div>
  );
}

function AvailabilityEditor({ employee, rows, onChange }: { employee: Employee; rows: Availability[]; onChange: () => Promise<void> }) {
  const [draft, setDraft] = useState<Availability>({ employee_id: employee.id, day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00', preference: 'available', note: '' });
  const [err, setErr] = useState('');
  const sorted = [...rows].sort((a, b) => DAY_ORDER.indexOf(a.day_of_week) - DAY_ORDER.indexOf(b.day_of_week) || a.start_time.localeCompare(b.start_time));
  const add = async () => { try { await upsertRow('employee_availability', draft); await onChange(); setErr(''); } catch (e) { setErr((e as Error).message); } };
  const hasPositive = rows.some(r => r.preference !== 'unavailable');

  return (
    <div className="subsection">
      <h4>Usual availability</h4>
      <p className="muted small">
        {hasPositive
          ? 'Only scheduled inside the available/preferred windows below.'
          : 'No windows set — can be scheduled any time the store is open (minus “unavailable” blocks).'}
      </p>
      <table className="table compact">
        <tbody>
          {sorted.map(r => (
            <tr key={r.id}>
              <td>{DAY_NAMES[r.day_of_week]}</td>
              <td>{fmtTime(r.start_time)}–{fmtTime(r.end_time)}</td>
              <td><span className={`pref ${r.preference}`}>{r.preference}</span></td>
              <td className="muted">{r.note}</td>
              <td><button className="link danger" onClick={async () => { await deleteRow('employee_availability', r.id!); await onChange(); }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row add">
        <select value={draft.day_of_week} onChange={e => setDraft({ ...draft, day_of_week: Number(e.target.value) })}>
          {DAY_ORDER.map(d => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
        </select>
        <input type="time" value={toInputTime(draft.start_time)} onChange={e => setDraft({ ...draft, start_time: toDbTime(e.target.value) })} />
        <input type="time" value={toInputTime(draft.end_time)} onChange={e => setDraft({ ...draft, end_time: toDbTime(e.target.value) })} />
        <select value={draft.preference} onChange={e => setDraft({ ...draft, preference: e.target.value as Preference })}>
          <option value="available">available</option><option value="preferred">preferred</option><option value="unavailable">unavailable</option>
        </select>
        <input placeholder="note (e.g. class)" value={draft.note ?? ''} onChange={e => setDraft({ ...draft, note: e.target.value })} />
        <button onClick={add}>Add</button>
      </div>
      {err && <div className="banner error">{err}</div>}
    </div>
  );
}

function ConflictEditor({ employee, data, onChange }: { employee: Employee; data: StoreData; onChange: () => Promise<void> }) {
  const mine = data.conflicts.filter(c => c.employee_a === employee.id || c.employee_b === employee.id);
  const others = data.employees.filter(e => e.id !== employee.id && e.active);
  const [draft, setDraft] = useState<Conflict>({ employee_a: employee.id, employee_b: others[0]?.id ?? '', severity: 'avoid', reason: '' });
  const [err, setErr] = useState('');
  const nameOf = (id: string) => { const e = data.employees.find(x => x.id === id); return e ? fullName(e) : '?'; };
  const add = async () => { try { await upsertRow('employee_conflicts', draft); await onChange(); setErr(''); } catch (e) { setErr((e as Error).message); } };

  return (
    <div className="subsection">
      <h4>Keep apart from</h4>
      <table className="table compact">
        <tbody>
          {mine.map(c => (
            <tr key={c.id}>
              <td>{nameOf(c.employee_a === employee.id ? c.employee_b : c.employee_a)}</td>
              <td><span className={`pref ${c.severity === 'never' ? 'unavailable' : 'preferred'}`}>{c.severity === 'never' ? 'never together' : 'avoid if possible'}</span></td>
              <td className="muted">{c.reason}</td>
              <td><button className="link danger" onClick={async () => { await deleteRow('employee_conflicts', c.id!); await onChange(); }}>✕</button></td>
            </tr>
          ))}
          {!mine.length && <tr><td className="muted">No conflicts.</td></tr>}
        </tbody>
      </table>
      <div className="row add">
        <select value={draft.employee_b} onChange={e => setDraft({ ...draft, employee_b: e.target.value })}>
          {others.map(e => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
        </select>
        <select value={draft.severity} onChange={e => setDraft({ ...draft, severity: e.target.value as Conflict['severity'] })}>
          <option value="avoid">avoid if possible</option><option value="never">never together</option>
        </select>
        <input placeholder="reason (private)" value={draft.reason ?? ''} onChange={e => setDraft({ ...draft, reason: e.target.value })} />
        <button onClick={add}>Add</button>
      </div>
      {err && <div className="banner error">{err}</div>}
    </div>
  );
}
