import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import AuthShell from './AuthShell';

type Mode = 'signin' | 'forgot';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const switchTo = (m: Mode) => { setMode(m); setError(''); setNotice(''); };

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    // One generic message: don't reveal whether the email has an account
    if (error) setError('That email and password don’t match. Try again or reset your password.');
  }

  async function magicLink() {
    if (!email) { setError('Enter your email first.'); return; }
    setBusy(true); setError('');
    await supabase.auth.signInWithOtp({
      email, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    setNotice('If that email has an account, a sign-in link is on its way.');
  }

  async function sendReset(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setBusy(false);
    setNotice('If that email has an account, a reset link is on its way. It expires in 1 hour.');
  }

  if (mode === 'forgot') {
    return (
      <AuthShell>
        <button type="button" className="link back" onClick={() => switchTo('signin')}>‹ Back to sign in</button>
        <h1>Reset your password</h1>
        <p className="lede">Enter your work email and we’ll send you a link to choose a new password.</p>
        <form onSubmit={sendReset} className="auth-form">
          <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <button className="primary big" disabled={busy}>Send reset link</button>
        </form>
        {notice && <div className="callout ok" role="status">{notice}</div>}
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="lede">Sign in to build and publish schedules.</p>
      <form onSubmit={signIn} className="auth-form">
        <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>
          <span className="label-row">Password
            <button type="button" className="link" onClick={() => switchTo('forgot')}>Forgot password?</button>
          </span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <div className="callout err" role="alert">{error}</div>}
        <button className="primary big" disabled={busy}>Sign in</button>
      </form>
      <div className="divider"><span>or</span></div>
      <button type="button" className="big" onClick={magicLink} disabled={busy}>Email me a sign-in link</button>
      {notice && <div className="callout ok" role="status">{notice}</div>}
      <div className="callout plain">
        <strong>New manager?</strong> Accounts are invite-only. Ask your store admin to send you an invite.
      </div>
    </AuthShell>
  );
}
