// Fails the deploy early, with a clear message, if configuration is missing or unsafe.
// Never prints secret values.
const env = process.env;
const where = `the "${env.DEPLOY_ENV ?? '?'}" environment (Settings → Environments)`;
const errors = [];

if (!env.VITE_SUPABASE_URL) errors.push(`Variable VITE_SUPABASE_URL is not set in ${where}.`);
else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.VITE_SUPABASE_URL))
  errors.push('VITE_SUPABASE_URL should look like https://<project-ref>.supabase.co');

if (!env.CLOUDFLARE_ACCOUNT_ID) errors.push(`Variable CLOUDFLARE_ACCOUNT_ID is not set in ${where}.`);
if (env.HAS_CF_TOKEN !== 'true') errors.push(`Secret CLOUDFLARE_API_TOKEN is not set in ${where}.`);

const key = env.VITE_SUPABASE_ANON_KEY ?? '';
if (!key) {
  errors.push(`Secret VITE_SUPABASE_ANON_KEY is not set in ${where}.`);
} else if (key.startsWith('sb_secret_')) {
  errors.push('VITE_SUPABASE_ANON_KEY is a Supabase SECRET key. It would be published in the website bundle. Use the publishable (sb_publishable_…) or anon key, and rotate the secret key now.');
} else if (key.split('.').length === 3) {
  // Legacy JWT keys: make sure it isn't the service_role key.
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role !== 'anon') {
      errors.push(`VITE_SUPABASE_ANON_KEY has role "${payload.role}". Only the anon key may be used in the browser. If this was the service_role key, rotate it now.`);
    }
  } catch {
    errors.push('VITE_SUPABASE_ANON_KEY looks like a JWT but could not be decoded.');
  }
}

for (const e of errors) console.log(`::error title=Deploy configuration::${e}`);
if (errors.length) process.exit(1);
console.log(`Configuration OK for ${env.DEPLOY_ENV}.`);
