import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env');
}

/**
 * Invite and password-reset emails land back here with `#...&type=invite`
 * (or `type=recovery`) in the URL. supabase-js consumes and clears that hash
 * when it signs the user in, so read it before creating the client.
 */
function readRedirectType(): 'invite' | 'recovery' | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const type = params.get('type');
  return type === 'invite' || type === 'recovery' ? type : null;
}
export const authRedirectType = readRedirectType();

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Throw on Supabase errors so callers can just await. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
