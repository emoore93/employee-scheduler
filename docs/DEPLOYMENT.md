# Deployment & secrets

How code gets from a push to a live URL, where every secret is kept, and how
the build picks them up.

```
 push to staging ─► verify ─► deploy (env: staging) ─────────────► https://shift-planner-staging.<subdomain>.workers.dev
 PR staging→main ─► verify
 merge to main   ─► verify ─► ⏸ approval ─► deploy (env: production) ─► https://shift-planner.<subdomain>.workers.dev

 Both sites sit behind Cloudflare Access (sign-in required), then the app's own login.
```

The workflow is `.github/workflows/pipeline.yml`:

- **verify** runs on every push and pull request. It installs from the lockfile,
  audits dependencies, type-checks, runs the scheduler tests, and does a
  build. This job has **no access to any secret**.
- **deploy** runs only on pushes to `staging` or `main`. It enters a GitHub
  Environment, which is the only way to get at that environment's secrets,
  builds with that environment's config, and uploads it as a Cloudflare
  Worker (static files only; see `wrangler.jsonc`).

---

## 1. Where secrets live

| Name | Kind | Stored in | How sensitive | Read by |
|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **Secret** | GitHub → Environments → `staging` and `production` | **High.** Can deploy over your site | Only the "Deploy to Cloudflare Workers" step |
| `VITE_SUPABASE_ANON_KEY` | Secret | GitHub → Environments → each env (different value per env) | Low. Public by design (see §3) | Only the Build step |
| `VITE_SUPABASE_URL` | Variable | GitHub → Environments → each env | Public | Build step |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | GitHub → Environments → each env | Not secret (an ID) | Deploy step |
| `DEPLOY_ENABLED` | Variable (`true`) | GitHub → repo-level **Variables** | Public | Turns deploys on |
| Supabase `service_role` / `sb_secret_…` key, DB password | **Never in GitHub, never in the front end** | Your password manager. The invite Edge Function gets the key from Supabase itself | **Critical.** Bypasses all security | Only the `invite-user` function, inside Supabase |
| Local dev values | `.env` file on your machine (ignored by git) | Your laptop only | Use **staging** values only | `npm run dev` |

Rules:

1. **Nothing secret is ever committed.** `.env` is in `.gitignore`. Only
   `.env.example` (placeholders) is in the repo.
2. **Use environment secrets, not repository secrets.** GitHub only releases an
   environment's secrets to a job that targets that environment *and* passes its
   protection rules. Staging can only be deployed from the `staging` branch, and
   production only from `main`, after you approve it. Pull requests, including
   ones from forks and Dependabot, can't reach them.
3. **Separate values per environment.** Staging and production point at
   different Supabase projects. A mistake in staging can't touch real data.
4. **Anything named `VITE_*` ends up public.** Never put the Supabase
   service_role or secret key in a `VITE_` variable. The deploy job checks for
   this (`scripts/check-deploy-config.mjs`) and refuses to deploy if it finds one.

## 2. How the build ingests them

1. GitHub stores secrets encrypted. When the **deploy** job starts, GitHub
   checks the environment's rules: right branch, and approval for production.
   Only then does it decrypt that environment's secrets onto the runner.
2. The workflow maps each secret into the environment **of a single step**
   (`env:` on the step, not the job). The install step runs with **no secrets**,
   so a malicious package install script would have nothing to steal. Installs
   also use `--ignore-scripts`.
3. **Build step:** Vite reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   from the process environment and swaps them into the JavaScript at build
   time. No `.env` file is written.
4. **Deploy step:** only this step receives `CLOUDFLARE_API_TOKEN`, which the
   Cloudflare action uses to upload `dist/`.
5. GitHub masks secret values in logs. Our scripts never print them.
6. The runner is a throwaway VM, destroyed when the job ends.

## 3. Why the Supabase anon key isn't really a secret

The anon key (or newer "publishable" `sb_publishable_…` key) ships inside the
website's JavaScript. Anyone can open dev tools and read it. That's how
Supabase is designed. What actually protects the data:

- **Row Level Security.** It's on for every table in the schema.
- **Sign-ups disabled**, so only managers you invite can get a session.
- **Cloudflare Access on staging**, so strangers can't even load the test site.

It's stored as a GitHub secret anyway, which keeps it out of logs and keeps
staging and production values apart. But treat RLS as the lock, not the key.

---

## 4. One-time setup

### a) Commit a lockfile
The pipeline won't deploy without `package-lock.json`, because unpinned
dependencies are a supply-chain risk.
- On a computer: `npm install`, then commit `package-lock.json`.
- No computer handy: the first CI run uploads a generated lockfile. Open
  **Actions → the run → Artifacts → package-lock**, download it, and commit it.

### b) Two Supabase projects
1. Create `shift-planner-staging` and `shift-planner-prod`. The free plan allows two.
2. In **both**, run the SQL migrations in order: `…_schema.sql`, then
   `…_roles.sql`. Run the **seed only in staging**.
3. **Authentication → Sign In / Providers → Email:** turn off "Allow new
   users to sign up". Set minimum password length to **12**.
4. **Authentication → URL Configuration:** Site URL = that environment's
   address. Under Redirect URLs, add the same address (plus
   `http://localhost:5173` in staging only).
5. **Deploy the invite function** to each project (needs the Supabase CLI):
   ```bash
   supabase link --project-ref <ref>
   supabase functions deploy invite-user
   supabase secrets set ALLOWED_ORIGINS="https://shift-planner-staging.<subdomain>.workers.dev"   # prod: https://shift-planner.<subdomain>.workers.dev
   ```
   The function gets the service-role key from Supabase automatically. It
   never touches GitHub or the browser.
6. **Make yourself admin.** Invite yourself from **Authentication → Users →
   Invite user**, accept the email, then run this in the SQL Editor:
   `update public.app_users set role = 'admin' where email = 'you@example.com';`
   From then on, invite everyone else from the app's **Users** tab.
7. Note each project's URL and anon/publishable key (**Project Settings → API**).

### c) Cloudflare Workers + Access
Hosting is Cloudflare Workers serving static files. There's no project to
create: the first deploy creates both Workers (`shift-planner-staging` and
`shift-planner`).

1. **Find your workers.dev subdomain:** Workers & Pages → the right-hand
   panel shows `<subdomain>.workers.dev`. Your sites will be
   `https://shift-planner-staging.<subdomain>.workers.dev` and `https://shift-planner.<subdomain>.workers.dev`.
2. **Make every Worker private by default, before the first deploy.** Zero
   Trust → Access → turn on Access for **all Workers in your account**. In the
   policy, allow only your managers' emails, with login method **One-time PIN**.
   Every Worker is then behind a sign-in from the moment it exists. It's free
   for up to 50 users.
   *Alternative:* after the first deploy, open each Worker → **Settings →
   Domains & Routes → workers.dev → Enable Cloudflare Access**, then **Manage
   Cloudflare Access** to set the email list. The site is public until you do
   this.
3. If you created a Worker by hand while exploring, delete it (Workers &
   Pages → the Worker → Settings → Delete). If it was set up with Git,
   also delete any repo it created in your GitHub.

### d) Cloudflare API token (least privilege)
**My Profile → API Tokens → Create Token → Custom token**
- Permissions: **Account → Workers Scripts → Edit** and **Account → Account
  Settings → Read**. Nothing else. If the first deploy fails with a
  permissions error, recreate the token from the **Edit Cloudflare Workers**
  template, which grants more than this pipeline needs.
- Account resources: **Include → your account only**
- Client IP filtering: leave blank (GitHub's runner IPs change)
- **TTL:** set an end date about 90 days out, and add a calendar reminder to rotate it.

Copy it once, straight into GitHub (next step). If you keep a copy, use a
password manager, not notes, chat or email.
*Optional, stronger:* make two tokens, one for each environment, so you can
revoke them independently.

### e) GitHub Environments
**Repo → Settings → Environments → New environment**

`staging`
- Deployment branches and tags: **Selected branches → `staging`**
- Secrets: `CLOUDFLARE_API_TOKEN`, `VITE_SUPABASE_ANON_KEY` (staging project)
- Variables: `VITE_SUPABASE_URL` (staging project), `CLOUDFLARE_ACCOUNT_ID`

`production`
- Deployment branches and tags: **Selected branches → `main`**
- **Required reviewers: you.** Every production deploy then waits for you to
  click Approve.
- Secrets: `CLOUDFLARE_API_TOKEN`, `VITE_SUPABASE_ANON_KEY` (prod project)
- Variables: `VITE_SUPABASE_URL` (prod project), `CLOUDFLARE_ACCOUNT_ID`

### f) Turn deploys on
**Settings → Secrets and variables → Actions → Variables → New repository
variable:** `DEPLOY_ENABLED` = `true`. Until this
exists, the pipeline only verifies and never deploys.

### g) Harden the repo
- **Settings → Actions → General**
  - Actions permissions: **Allow select actions** → allow actions by GitHub,
    plus `cloudflare/wrangler-action@*`
  - Fork pull request workflows: **Require approval for all external contributors**
  - Workflow permissions: **Read repository contents**; leave "Allow GitHub
    Actions to create and approve pull requests" **off**
- **Settings → Rules → Rulesets**
  - `main`: require a pull request, require the status check **Type-check, test,
    build**, block force pushes and deletion
  - `staging`: block force pushes and deletion
- **Settings → Code security:** turn on Dependabot alerts and security updates.
  Turn on secret scanning with push protection if your plan offers it. It's
  free for public repos.

---

## 5. Who can do what

Two separate locks, both free:

| Layer | Decides | Managed in |
|---|---|---|
| Cloudflare Access | Who can load the site at all | Zero Trust → Access → your app's policy (email list) |
| Supabase Auth + `app_users` | Who can sign in, and their role | App → **Users** tab (admins) |

| Role | Can |
|---|---|
| admin | Everything, plus invite people, change roles, remove access |
| manager | Build/publish schedules; edit employees, time off, store setup |
| viewer | See published schedules only. Can't see the "keep apart" list |

Roles are enforced by Row Level Security in Postgres. The UI just hides
buttons, but the database refuses the write regardless. New accounts start as
**viewer**. Only an admin can promote someone, and the last admin can't be
demoted or removed. A role a user claims in their own profile data is
ignored.

When someone leaves: **Users → Remove access** (instant), take them off the
Cloudflare Access email list, and optionally delete their login under
Supabase → Authentication → Users.

## 6. Day to day

1. Push to `staging`. After about 2 minutes, test at
   `https://shift-planner-staging.<subdomain>.workers.dev`.
2. Open a PR from `staging` to `main`. CI must pass before you can merge.
3. Merge. The production deploy waits for you. Go to **Actions → the run →
   Review deployments → Approve**.
4. **Rollback:** Cloudflare → Workers & Pages → `shift-planner` →
   **Deployments** → pick an earlier version → **Rollback**. You can also
   `git revert` and merge.

## 7. If a secret leaks

- **Cloudflare token:** revoke it in Cloudflare (My Profile → API Tokens),
  create a new one, and update it in both GitHub environments. Then check the
  Workers' deployment history for anything you didn't push.
- **Supabase service_role / secret key** (should never be anywhere near this
  repo): rotate it in Supabase → Project Settings → API immediately, and review
  the database for changes.
- **Anon key:** low impact. Rotate if you like, update the environment secret,
  and redeploy.

## 8. Later: database migrations in the pipeline
Pushing schema changes from CI needs more powerful credentials: a Supabase
access token and the database password. If you add that, put them in the
same environments as **secrets**, use them in a separate job that requires
approval for production, and never expose them to the front-end build.
