import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { inviteUser, listAppUsers, removeAppUser, setUserRole } from '../lib/api';
import type { AppRole, AppUser } from '../lib/types';

const ROLE_HELP: Record<AppRole, string> = {
  admin: 'Everything, plus managing who has access',
  manager: 'Build and publish schedules; edit employees, time off and store setup',
  viewer: 'Read-only. Can’t see the “keep apart” list',
};
const ROLES: AppRole[] = ['admin', 'manager', 'viewer'];

export default function UsersPage({ myUserId }: { myUserId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('manager');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { setUsers(await listAppUsers()); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<void>) {
    setErr(''); setNotice('');
    try { await fn(); await load(); } catch (e) { setErr((e as Error).message); }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await act(async () => {
      await inviteUser(email, role);
      setNotice(`Invite sent to ${email}.`);
      setEmail('');
    });
    setBusy(false);
  }

  return (
    <section className="users">
      <div className="toolbar"><h2>Users &amp; access</h2></div>
      {err && <div className="banner error">{err}</div>}
      {notice && <div className="banner ok">{notice}</div>}

      <form className="card add-card" onSubmit={invite}>
        <h4>Invite someone</h4>
        <div className="row add">
          <label className="grow">Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label>Role
            <select value={role} onChange={e => setRole(e.target.value as AppRole)}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button className="primary" disabled={busy}>Send invite</button>
        </div>
        <p className="muted small">{ROLE_HELP[role]}. The invite link works once and expires in 24 hours.</p>
      </form>

      <table className="table">
        <thead><tr><th>Email</th><th>Role</th><th>Added</th><th /></tr></thead>
        <tbody>
          {users.map(u => {
            const me = u.user_id === myUserId;
            return (
              <tr key={u.user_id}>
                <td>{u.email}{me && <span className="tag">you</span>}</td>
                <td>
                  <select value={u.role} aria-label={`Role for ${u.email}`}
                    onChange={e => act(() => setUserRole(u.user_id, e.target.value as AppRole))}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="muted">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="actions">
                  {!me && (
                    <button className="link danger" onClick={() => {
                      if (confirm(`Remove ${u.email}'s access? They won't be able to see anything.`)) {
                        act(() => removeAppUser(u.user_id));
                      }
                    }}>Remove access</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="role-help">
        {ROLES.map(r => <div key={r}><dt>{r}</dt><dd>{ROLE_HELP[r]}</dd></div>)}
      </dl>
    </section>
  );
}
