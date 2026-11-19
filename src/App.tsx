import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { listStores, loadStoreData, type StoreData } from './lib/api';
import type { Store } from './lib/types';
import Login from './pages/Login';
import SchedulePage from './pages/SchedulePage';
import EmployeesPage from './pages/EmployeesPage';
import TimeOffPage from './pages/TimeOffPage';
import StorePage from './pages/StorePage';

type Tab = 'schedule' | 'employees' | 'timeoff' | 'store';
const TABS: [Tab, string][] = [
  ['schedule', 'Schedule'], ['employees', 'Employees'], ['timeoff', 'Time off'], ['store', 'Store setup'],
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [data, setData] = useState<StoreData | null>(null);
  const [tab, setTab] = useState<Tab>('schedule');
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    listStores().then(s => {
      setStores(s);
      setStoreId(prev => prev || localStorageGet('storeId') || s[0]?.id || '');
    }).catch(e => setError(String(e.message ?? e)));
  }, [session]);

  const reload = useCallback(async () => {
    if (!storeId) return;
    try { setData(await loadStoreData(storeId)); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, [storeId]);

  useEffect(() => { reload(); localStorageSet('storeId', storeId); }, [reload, storeId]);

  if (!ready) return null;
  if (!session) return <Login />;

  return (
    <div className="app">
      <header className="topbar no-print">
        <strong className="brand">Shift Planner</strong>
        {stores.length > 1 ? (
          <select value={storeId} onChange={e => setStoreId(e.target.value)}>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : <span className="muted">{stores[0]?.name}</span>}
        <nav>
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>{label}</button>
          ))}
        </nav>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      {error && <div className="banner error">{error}</div>}
      <main>
        {!storeId && <p className="muted">No stores yet — run supabase/seed.sql or add a store in Supabase.</p>}
        {data && storeId && tab === 'schedule' && <SchedulePage storeId={storeId} storeName={stores.find(s => s.id === storeId)?.name ?? ''} data={data} />}
        {data && storeId && tab === 'employees' && <EmployeesPage storeId={storeId} data={data} reload={reload} />}
        {data && storeId && tab === 'timeoff' && <TimeOffPage data={data} reload={reload} />}
        {data && storeId && tab === 'store' && <StorePage storeId={storeId} data={data} reload={reload} />}
      </main>
    </div>
  );
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { if (v) localStorage.setItem(k, v); } catch { /* ignore */ } }
