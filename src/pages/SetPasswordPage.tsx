import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import AuthShell, { MIN_PASSWORD } from './AuthShell';

/** Shown after following an invite link (new account) or a password-reset link. */
export default function SetPasswordPage({ mode, email, onDone }: {
  mode: 'invite' | 'recovery'; email: string; onDone: () => void;
}) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const longEnough = pw.length >= MIN_PASSWORD;
  const matches = pw.length > 0 && pw === pw2;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!longEnough || !matches) return;
    setBusy(true); setError('');
    const { error } = await supabase.auth.updateUser({
      password: pw,
      ...(mode === 'invite' ? { data: { first_name: first.trim(), last_name: last.trim() } } : {}),
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    window.history.replaceState(null, '', window.location.pathname);
    onDone();
  }

  return (
    <AuthShell>
      <h1>{mode === 'invite' ? 'You’re invited' : 'Choose a new password'}</h1>
      <p className="lede">{mode === 'invite' ? 'Set up your Shift Planner account.' : 'Pick a new password for your account.'}</p>
      <form onSubmit={submit} className="auth-form">
        <label>Email<input type="email" value={email} readOnly className="readonly" /></label>
        {mode === 'invite' && (
          <div className="two">
            <label>First name<input autoComplete="given-name" value={first} onChange={e => setFirst(e.target.value)} required /></label>
            <label>Last name<input autoComplete="family-name" value={last} onChange={e => setLast(e.target.value)} required /></label>
          </div>
        )}
        <label>{mode === 'invite' ? 'Create a password' : 'New password'}
          <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required />
        </label>
        <ul className="rules">
          <li className={longEnough ? 'met' : ''}>At least {MIN_PASSWORD} characters</li>
          <li className={matches ? 'met' : ''}>Passwords match</li>
        </ul>
        <label>Confirm password
          <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required />
        </label>
        {error && <div className="callout err" role="alert">{error}</div>}
        <button className="primary big" disabled={busy || !longEnough || !matches}>
          {mode === 'invite' ? 'Create account' : 'Save password'}
        </button>
      </form>
    </AuthShell>
  );
}
