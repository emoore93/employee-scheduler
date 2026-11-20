# Deployment & secrets

How code gets from a push to a live URL, where every secret is kept, and how
the build picks them up.

```
 push to staging ─► verify ─► deploy (env: staging) ─────────────► https://staging.<project>.pages.dev  (sign-in required via Cloudflare Access)
 PR staging→main ─► verify
 merge to main   ─► verify ─► ⏸ approval ─► deploy (env: production) ─► https://<project>.pages.dev
```

The workflow is `.github/workflows/pipeline.yml`:

- **verify** runs on every push and pull request. It installs from the lockfile,
  audits dependencies, type-checks, runs the scheduler tests, and does a
  build. This job has **no access to any secret**.
- **deploy** runs only on pushes to `staging` or `main`. It enters a GitHub
  Environment, which is the only way to get at that environment's secrets,
  builds with that environment's config, and uploads to Cloudflare Pages.

---

## 1. Where secrets live

| Name | Kind | Stored in | How sensitive | Read by |
|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **Secret** | GitHub → Environments → `staging` and `production` | **High.** Can deploy over your site | Only the "Deploy to Cloudflare Pages" step |
| `VITE_SUPABASE_ANON_KEY` | Secret | GitHub → Environments → each env (different value per env) | Low. Public by design (see §3) | Only the Build step |
| `VITE_SUPABASE_URL` | Variable | GitHub → Environments → each env | Public | Build step |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | GitHub → Environments → each env | Not secret (an ID) | Deploy step |
| `CLOUDFLARE_PAGES_PROJECT` | Variable | GitHub → repo-level **Variables** | Public | Turns deploys on |
| Supabase `service_role` / `sb_secret_…` key, DB password | **Never in GitHub, never in the front end** | Your password manager | **Critical.** Bypasses all security | Nothing in this repo |
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
2. Run the schema migration in both. Run the **seed only in staging**.
3. In each: **Authentication → Sign In / Providers →** turn off new sign-ups.
4. In each: **Authentication → URL Configuration →** set Site URL to that
   environment's address (`https://staging.<project>.pages.dev` or
   `https://<project>.pages.dev`).
5. Note each project's URL and anon/publishable key (**Project Settings → API**).

### c) Cloudflare Pages project
1. Create the project once with production branch `main`. Either:
   - dashboard: **Workers & Pages → Create → Pages → Upload assets** (upload
     any file; the pipeline replaces it), or
   - CLI: `npx wrangler pages project create shift-planner --production-branch=main`
2. **Lock down staging:** project → **Settings → General → Enable access
   policy**. Because `main` is the production branch, `staging` counts as a
   preview. Its URL now requires a Cloudflare sign-in. Add teammates' emails
   to the Access policy if others need to test.

### d) Cloudflare API token (least privilege)
**My Profile → API Tokens → Create Token → Custom token**
- Permissions: **Account → Cloudflare Pages → Edit**. Nothing else.
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
variable:** `CLOUDFLARE_PAGES_PROJECT` = your Pages project name. Until this
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

## 5. Day to day

1. Push to `staging`. After about 2 minutes, test at
   `https://staging.<project>.pages.dev`.
2. Open a PR from `staging` to `main`. CI must pass before you can merge.
3. Merge. The production deploy waits for you. Go to **Actions → the run →
   Review deployments → Approve**.
4. **Rollback:** Cloudflare → your Pages project → **Deployments** → choose an
   earlier production deployment → **Rollback**. You can also `git revert` and
   merge.

## 6. If a secret leaks

- **Cloudflare token:** revoke it in Cloudflare (My Profile → API Tokens),
  create a new one, and update it in both GitHub environments. Then check the
  Pages deployment history for anything you didn't push.
- **Supabase service_role / secret key** (should never be anywhere near this
  repo): rotate it in Supabase → Project Settings → API immediately, and review
  the database for changes.
- **Anon key:** low impact. Rotate if you like, update the environment secret,
  and redeploy.

## 7. Later: database migrations in the pipeline
Pushing schema changes from CI needs more powerful credentials: a Supabase
access token and the database password. If you add that, put them in the
same environments as **secrets**, use them in a separate job that requires
approval for production, and never expose them to the front-end build.
