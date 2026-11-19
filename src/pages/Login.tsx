import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function withPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMsg(error.message);
  }

  async function magicLink() {
    if (!email) return setMsg('Enter your email first');
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    setMsg(error ? error.message : 'Check your email for a sign-in link.');
  }

  return (
    <div className="login">
      <form onSubmit={withPassword} className="card">
        <h1>Shift Planner</h1>
        <p className="muted">Managers sign in to build and publish schedules.</p>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="primary" disabled={busy}>Sign in</button>
        <button type="button" className="link" onClick={magicLink} disabled={busy}>Email me a sign-in link instead</button>
        {msg && <p className="note">{msg}</p>}
      </form>
    </div>
  );
}
