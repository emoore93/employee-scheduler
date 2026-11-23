import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { authRedirectType, supabase } from './lib/supabase';
import { getMyRole, listStores, loadStoreData, type StoreData } from './lib/api';
import type { AppRole, Store } from './lib/types';
import AuthPage from './pages/AuthPage';
import SetPasswordPage from './pages/SetPasswordPage';
import NoAccessPage from './pages/NoAccessPage';
import SchedulePage from './pages/SchedulePage';
import EmployeesPage from './pages/EmployeesPage';
import TimeOffPage from './pages/TimeOffPage';
import StorePage from './pages/StorePage';
import UsersPage from './pages/UsersPage';

type Tab = 'schedule' | 'employees' | 'timeoff' | 'store' | 'users';
const TABS: { key: Tab; label: string; roles: AppRole[] }[] = [
  { key: 'schedule', label: 'Schedule', roles: ['admin', 'manager', 'viewer'] },
  { key: 'employees', label: 'Employees', roles: ['admin', 'manager'] },
  { key: 'timeoff', label: 'Time off', roles: ['admin', 'manager'] },
  { key: 'store', label: 'Store setup', roles: ['admin', 'manager'] },
  { key: 'users', label: 'Users', roles: ['admin'] },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [pendingPassword, setPendingPassword] = useState<'invite' | 'recovery' | null>(authRedirectType);
  const [role, setRole] = useState<AppRole | null | undefined>(undefined);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [data, setData] = useState<StoreData | null>(null);
  const [tab, setTab] = useState<Tab>('schedule');
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setPendingPassword('recovery');
      if (event === 'SIGNED_OUT') { setRole(undefined); setData(null); setStores([]); setStoreId(''); }
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    setRole(undefined);
    getMyRole().then(setRole).catch(e => { setError((e as Error).message); setRole(null); });
  }, [userId]);

  useEffect(() => {
    if (!role) return;
    listStores().then(s => {
      setStores(s);
      setStoreId(prev => prev || localStorageGet('storeId') || s[0]?.id || '');
    }).catch(e => setError(String(e.message ?? e)));
  }, [role]);

  const reload = useCallback(async () => {
    if (!storeId || !role) return;
    try { setData(await loadStoreData(storeId)); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, [storeId, role]);

  useEffect(() => { reload(); localStorageSet('storeId', storeId); }, [reload, storeId]);

  if (!ready) return null;
  if (!session) return <AuthPage />;
  if (pendingPassword) {
    return <SetPasswordPage mode={pendingPassword} email={session.user.email ?? ''} onDone={() => setPendingPassword(null)} />;
  }
  if (role === undefined) return <div className="loading">Loading…</div>;
  if (role === null) return <NoAccessPage email={session.user.email ?? ''} />;

  const tabs = TABS.filter(t => t.roles.includes(role));
  const activeTab = tabs.some(t => t.key === tab) ? tab : 'schedule';
  const canEdit = role !== 'viewer';

  return (
    <div className="app">
      <header className="topbar no-print">
        <strong className="brand">Shift Planner</strong>
        {stores.length > 1 ? (
          <select value={storeId} onChange={e => setStoreId(e.target.value)} aria-label="Store">
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : <span className="muted">{stores[0]?.name}</span>}
        <nav>
          {tabs.map(t => (
            <button key={t.key} className={activeTab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </nav>
        <span className="muted small who">{session.user.email} · {role}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      {error && <div className="banner error">{error}</div>}
      <main>
        {activeTab === 'users' && <UsersPage myUserId={session.user.id} />}
        {activeTab !== 'users' && !storeId && <p className="muted">No stores yet. Run supabase/seed.sql or add a store in Supabase.</p>}
        {data && storeId && activeTab === 'schedule' && (
          <SchedulePage storeId={storeId} storeName={stores.find(s => s.id === storeId)?.name ?? ''} data={data} readOnly={!canEdit} />
        )}
        {data && storeId && canEdit && activeTab === 'employees' && <EmployeesPage storeId={storeId} data={data} reload={reload} />}
        {data && storeId && canEdit && activeTab === 'timeoff' && <TimeOffPage data={data} reload={reload} />}
        {data && storeId && canEdit && activeTab === 'store' && <StorePage storeId={storeId} data={data} reload={reload} />}
      </main>
    </div>
  );
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { if (v) localStorage.setItem(k, v); } catch { /* ignore */ } }
