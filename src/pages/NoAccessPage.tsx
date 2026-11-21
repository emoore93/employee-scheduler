import { supabase } from '../lib/supabase';
import AuthShell from './AuthShell';

export default function NoAccessPage({ email }: { email: string }) {
  return (
    <AuthShell>
      <h1>No access yet</h1>
      <p className="lede">
        You’re signed in as <strong>{email}</strong>, but this account hasn’t been given access to Shift Planner.
        Ask your store admin to add you.
      </p>
      <button type="button" className="big" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </AuthShell>
  );
}
