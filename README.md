# Shift Planner — employee scheduling on Supabase

A manager-facing web app for building weekly store schedules, with an
auto-scheduler that respects availability, school hours, time off, and
people who shouldn't work together.

```
employee-scheduler/
├─ src/
│  ├─ lib/scheduler.ts     auto-scheduler + validator (pure TS, no deps)
│  ├─ lib/api.ts           Supabase reads/writes
│  ├─ pages/               Schedule, Employees, Time off, Store setup, Login
│  └─ styles.css
└─ test/scheduler.test.ts  engine tests against the seed data
```

## Recommended stack & hosting (lowest cost)

| Piece | Choice | Cost |
|---|---|---|
| Database + auth | **Supabase Free** (Postgres, email auth, RLS) | $0 |
| Front end | **Vite + React + TypeScript**, built to static files | — |
| Hosting | **Cloudflare Pages** (free, unlimited bandwidth, commercial use OK) | $0 |
| Auto-scheduler | Runs **in the browser** — no server to pay for | $0 |
| Custom domain (optional) | any registrar | ~$10/yr |

**Why this shape:** the app is a static site that talks straight to Supabase,
and Row Level Security in Postgres is what protects the data. There's no API
server to host, patch, or pay for. The scheduler finishes a week for ~20
people in well under a second in the browser.

**Things to know before going live**

- Supabase Free projects **pause after 7 days with no activity**. A store that
  schedules weekly is borderline. When this becomes the real system, move to
  Supabase Pro (about $25/mo), which doesn't pause and adds daily backups.
- Avoid Vercel's free Hobby plan for this: it's limited to personal,
  non-commercial use. Netlify's free tier or GitHub Pages would also work.
- Later, if you want the schedule to generate itself on a timer, or an
  employee-facing app, `src/lib/scheduler.ts` runs unchanged in a Supabase
  Edge Function (Deno). Nothing else needs to change.

## Setup (≈15 minutes)

1. **Create a Supabase project** at supabase.com.
2. **Create the schema and test data.** In the SQL Editor, run the schema
   migration and then the seed file. (These SQL files are kept separately
   from this front-end repo.) The seed can be re-run at any time: it wipes and
   rebuilds the demo store.
3. **Lock down sign-ups.** Authentication → Sign In / Providers → turn off
   "Allow new users to sign up". Then Authentication → Users → *Invite user*
   for each manager. (In v1, every signed-in user is a manager with full access.)
4. **Run locally**
   ```bash
   cp .env.example .env      # paste Project URL + anon key from Settings → API
   npm install
   npm run dev
   ```
5. **Deploy to Cloudflare Pages.** Push this repo to GitHub, then Cloudflare
   dashboard → Workers & Pages → Create → Pages → connect the repo.
   - Build command: `npm run build` · Output directory: `dist`
   - Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - In Supabase → Authentication → URL Configuration, add your `*.pages.dev`
     URL so magic-link sign-in redirects work.

## Data model

- `stores`, `store_hours` (weekly), `store_hour_exceptions` (holidays, early closes)
- `staffing_requirements`: how many people are needed and when. A row with no
  `role` is total headcount; a row with `role = 'shift_lead'` means "at least N
  leads", and those leads count toward the headcount.
- `employees`: roles, min/max hours per week, min/max shift length, max days, pay rate, minor flag
- `employee_availability`: recurring weekly windows (`available`, `preferred`, `unavailable`).
  If someone has any available/preferred windows, they're only scheduled inside them
  (e.g. a high-schooler at 3:30–9pm on weekdays). With none, they're open whenever the
  store is. `unavailable` blocks always win (class, church…).
- `time_off`: dated, whole or part day; `approved`, `pending`, or `denied`
- `employee_conflicts`: pairs who shouldn't overlap. `never` is a hard rule;
  `avoid` means keep them apart where possible.
- `schedules` (one per store per week, draft or published) and `shifts`

## How the auto-scheduler works

`generateSchedule()` in `src/lib/scheduler.ts`:

1. Builds per-30-minute demand from the staffing requirements, clipped to
   store hours and holiday exceptions.
2. Works out, for each employee and each slot, whether they can work: store
   open, inside their usual availability, not blocked, and no approved (or
   pending, by default) time off.
3. Fills role needs first (shift lead on the floor), then headcount. It always
   takes the **most constrained gap first**, meaning the slot with the fewest
   people who could cover it, so scarce people go where only they can help.
4. Scores each candidate shift: coverage it adds, fit with preferred windows,
   distance from their minimum hours, fairness (spreads hours), overlap with
   "avoid" partners (penalised per hour), and wasted hours.
5. **Hard rules are never broken**: availability, time off, `never` conflicts,
   max hours, max days, shift length, 10h rest between shifts, one shift a day.
6. Top-up pass: stretches or adds shifts for anyone under their minimum hours.
7. Reports any coverage it couldn't fill, plus warnings.

`validateShifts()` runs the same rules over any schedule, including hand
edits. The grid highlights shifts that break a rule. Publishing warns you if
there are violations. "Keep current shifts" treats your manual edits as locked
and fills in around them.

Tune it in `DEFAULT_OPTIONS` (slot size, rest hours, pending time off,
avoid penalty, break rules).

## Tests

```bash
npm test
```
These generate three weeks from the seed data, Thanksgiving week included, and
check that no hard rule is broken and that coverage reaches 100%.

## Ideas for next steps

- Employee self-service: view their schedule, request time off, set availability
  (add an `auth_user_id` to `employees` and per-role RLS policies)
- Email or SMS the published schedule (Supabase Edge Function + Resend or Twilio)
- Minor labour-law rules (latest end time on school nights, daily hour caps)
- Drag-and-drop shift editing
