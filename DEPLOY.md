# Hosting the stakeholder demo

This is the runbook for putting Nexraah in front of people who need to click
through it on demo data. To run it for real, on one shared database, see
[Going live](#going-live--the-real-database-and-servers). Read [what this is not](#what-this-is-not)
before you send anyone the link.

---

## What you are deploying

**Two Next.js apps, and nothing else.** With fixtures switched on, both portals
serve every screen from data baked into the browser bundle. There is no backend
to run, no database to provision, no secret to rotate.

| | |
|---|---|
| Internal console | `apps/internal-portal` → its own Vercel project |
| Transporter portal | `apps/vendor-portal` → its own Vercel project |
| `internal-api`, `vendor-api` | **Not deployed.** Nothing calls them in this mode |
| Supabase / Postgres | **Not needed.** No data leaves the browser |

Sign-in is real — the console's `/signin` screen checks the six fixture
accounts and mints its own token. Roles, permissions and every blocked state
behave exactly as they will in production, because the fixture adapter returns
the same shapes the real API returns.

---

## Deploy

### 1 · Push the repo somewhere Vercel can see it

GitHub, GitLab or Bitbucket. Vercel builds from a connected repository.

### 2 · Create the first project — the internal console

In Vercel: **Add New → Project → import the repo**, then before deploying:

| Setting | Value |
|---|---|
| **Root Directory** | `apps/internal-portal` |
| Framework preset | Next.js *(auto-detected)* |
| Build / install commands | leave as detected — Vercel resolves the pnpm workspace from the repo root on its own |

Add **one environment variable**, for every environment (Production, Preview, Development):

```
NEXT_PUBLIC_USE_MOCKS = 1
```

Then deploy.

### 3 · Create the second project — the transporter portal

**Add New → Project → import the same repo again.** Same steps, with:

| Setting | Value |
|---|---|
| **Root Directory** | `apps/vendor-portal` |

Environment variable:

```
NEXT_PUBLIC_MOCK = 1
```

> **This one is not optional and its default is wrong for a demo.**
> `NEXT_PUBLIC_MOCK` defaults to **off**, deliberately — a real deployment must
> never silently fall back to fixtures. Leave it unset and the transporter
> portal will build fine, deploy fine, and then fail on every screen trying to
> reach a backend that isn't there.

### 4 · Check both

Open each URL. Both land on a sign-in screen.

The console signs in by **email**; the transporter portal signs in by **mobile
number**, because that is what a transporter has on their vendor record and
many will not have an email. Demo login there is `9876543210` / `nexraah`, and
the screen has a "Fill it in for me" button that enters both.

---

## Signing in to the demo

The sign-in screen lists the five accounts. The password for all of them is:

```
nexraah
```

| Role | Account | Lands on |
|---|---|---|
| Operations | anil@nexraah.in | Today's queue |
| Compliance | meera@nexraah.in | Compliance desk |
| Finance | rakesh@nexraah.in | Payments → Balance |
| Leadership | vikram@nexraah.in | Monthly overview |
| Administrator | krishnan@nexraah.in | Control panel |

Sign in as different roles to show the permission model — a module a role
cannot act on is **absent from its sidebar**, which is the single most
persuasive thing to demonstrate live.

Suggested walkthrough: [`FLOWS.md`](FLOWS.md) §6 is the ten-step order
lifecycle in the order you'd click it.

---

## Keeping it private

Both projects ship `X-Robots-Tag: noindex, nofollow` and a `robots.txt`
disallowing everything, so neither should be indexed. That stops search
engines. It does **not** stop anyone who has the URL.

Three levels, pick one:

| | What it gives you | Cost |
|---|---|---|
| **The app's own sign-in** *(default)* | Anyone with the link sees a login screen, not data | Free |
| **Cloudflare Access** in front of the domains | Real gating — email allowlist, one-time codes, nobody without an invite reaches the app at all | Free tier covers ~50 users |
| **Vercel Deployment Protection** | Password or SSO on the deployment itself | Requires a paid Vercel plan |

> **Be clear-eyed about the first option.** The demo password lives in the
> JavaScript bundle, because the fixture adapter runs in the browser. Anyone who
> opens devtools can find it. That is fine for a link you hand to five
> stakeholders; it is not access control. If the URL might circulate beyond
> people you chose, use Cloudflare Access.

---

## What this is not

Worth stating plainly before anyone assumes otherwise.

- **Nothing is saved.** Every action works — raise an indent, award a quote,
  release a payment — and every change is lost on refresh. It is a working
  model of the app, not the app.
- **No real data exists, and none can be entered.** The figures are fixtures.
- **The transporter side is fully built on the real backend** — quote submit
  and withdraw, delivery-note upload, billing, fleet changes and document
  upload all exist. The demo exercises them against fixtures, so what a
  stakeholder sees a transporter do here is a fair representation of what the
  real system does, not a mock-up of something unbuilt.
- **Two decisions are still open** and both are visible in the demo: transporter
  logins are not created on activation (see [`FLOWS.md`](FLOWS.md) §12), and
  whether a losing transporter is told why they lost is contradicted between the
  spec and the built portal.

---

## Going live — the real database and servers

Everything above runs on data kept in each browser. Going live puts one shared
database behind both portals, so every desk sees the same records. You set up
four accounts; the code and its settings are ready for them.

**What has been checked, against a real PostgreSQL 17 (27 Oct 2026):** all 65
migrations apply in order to an empty database; `provision.mjs` sets the two
database logins, the storage bucket, staff and transporter sign-ins, and its
four permission checks pass (and running it twice is safe); `internal-api`
starts against that database and answers as each of the six staff roles —
load requests, quotes, rate cards, approvals, settings, invoices, orders — and
the transporter portal answers as a transporter, through the restricted
`vendor_api` login. What has **not** been tried is Supabase itself, Render and
Resend: the steps below are where those are first used.

### What you will create

| Service | What for | Free tier — and its catch |
|---|---|---|
| **Supabase** | The database, staff and transporter sign-in, file storage | 500 MB database, 1 GB files. A free project is paused after about a week with no use — daily use keeps it awake. |
| **Render** | The two backend servers (`render.yaml`) | Free, but a server sleeps after ~15 idle minutes. See step 7. |
| **Resend** | Sending the sign-in code emails | 3,000 emails a month, 100 a day. Needs a domain you can add DNS records to. |
| **Vercel** | The two websites (already running) | Unchanged. |

Keep every key and password below in the services' own settings screens or a
password manager — never in a chat, an email or the repository.

### 1 · Supabase — the project

1. Create a project. Region: **Mumbai (ap-south-1)**. Choose a strong database password and keep it.
2. Note four things:
   - **Project URL** — `https://<ref>.supabase.co` (`<ref>` is the project's id)
   - **anon key** — Project Settings → API Keys (the *anon* / public key; **never** the `service_role` key — the API refuses to start if it is set)
   - **Session pooler connection string** — the *Connect* button → **Session pooler** (port 5432). Not *Transaction pooler*: the two database logins depend on a connection keeping its login.
   - The database password from step 1.

### 2 · Supabase — the tables

From the repository root, with the session pooler string (as the `postgres` user):

```powershell
npx supabase db push --db-url "postgresql://postgres.<ref>:<db-password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

It applies the 65 migrations in `supabase/migrations`. **Do not run `supabase/seed.sql`** — that is made-up test data. Your company's details (NEXUS FREIGHT PRIVATE LIMITED, GST 37AAKCN9322K1ZY, the Gajuwaka address) are set by the migrations; correct anything else in Control panel → Company details once signed in.

### 3 · Supabase — logins, storage and people

1. `pnpm install` once at the repository root.
2. Copy `supabase/scripts/staff.example.json` to `staff.json` and list your staff: name, work email, role (`ADMIN`, `OPS`, `COMPLIANCE`, `FINANCE`, `BD`, `LEADERSHIP`). At least one `ADMIN`.
3. Copy `supabase/scripts/transporters.example.json` to `transporters.json` for transporters who will use the portal: their 10-digit mobile and their transporter code (`VND-…`). Transporters added later in the console can be added here and the script run again.
4. Make two strong passwords for the database logins and run:

```powershell
$env:INTERNAL_API_DB_PASSWORD = "<password 1>"
$env:VENDOR_API_DB_PASSWORD   = "<password 2>"
node supabase/scripts/provision.mjs --db-url "<the same session pooler string>" `
  --staff supabase/scripts/staff.json --transporters supabase/scripts/transporters.json
```

It must end with four ✓ checks and `Done.` It prints a temporary password for each new login: staff sign in with an emailed code (the password is not used); each **transporter** signs in to the portal with their mobile number and the password printed beside it — give it to them privately. Delete `staff.json` and `transporters.json` afterwards, or keep them out of the repository.

### 4 · Resend — the sign-in emails

1. Sign up at resend.com, add your sending domain, and add the DNS records it shows at your domain's registrar. Wait until it says *Verified*.
2. Create an API key.
3. Decide the sender, e.g. `Nexus Freight <no-reply@yourdomain.in>`.

### 5 · Render — the two backend servers

1. New → **Blueprint** → choose this repository. Render reads `render.yaml` and creates `nexraah-internal-api` and `nexraah-vendor-api`.
2. Fill in what it asks for:

| Setting | Value |
|---|---|
| `DATABASE_URL_INTERNAL` | the session pooler string with the user **`internal_api.<ref>`** and *password 1* |
| `DATABASE_URL_PORTAL` | the same with the user **`vendor_api.<ref>`** and *password 2* |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | the anon key |
| `SUPABASE_JWT_ISSUER` | `https://<ref>.supabase.co/auth/v1` |
| `PORTAL_SERVICE_KEY` | 64 random characters — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **the same value in both services** |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | from step 4 |
| `SEND_EMAIL_HOOK_SECRET` | leave empty for now — step 6 gives it |
| `ANTHROPIC_API_KEY` | leave empty (paid; without it, Fetch reads documents free in the browser) |
| `CORS_ORIGIN` (vendor-api) | the transporter portal's address, e.g. `https://nexraah-vendor-portal.vercel.app` |

3. When `nexraah-internal-api` is live, open `https://nexraah-internal-api.onrender.com/api/v1/health` — it should answer `ok`. In its **Logs**, find the line **`portal pool authenticated as vendor_api`**. If it says anything else, stop: the transporter side would be reading with full access.

### 6 · Supabase — sign-in settings and the email hook

1. Authentication → Sign In / Providers → **Email**: on. **Allow new users to sign up: off** (only people you list can get a code). Email OTP expiration: **240** seconds. OTP length: **6**.
2. Authentication → **Hooks** → *Send Email hook* → type **HTTPS** → URL `https://nexraah-internal-api.onrender.com/api/v1/auth/email-hook` → generate the secret → **copy it into Render's `SEND_EMAIL_HOOK_SECRET`** and redeploy `nexraah-internal-api`.
3. Authentication → URL Configuration → Site URL: the console's address.

### 7 · Keep the backend awake (free plan only)

Supabase gives up on the email hook long before a sleeping Render server wakes, so the first sign-in after a quiet spell would get no email. On the free plan, have a free pinger (e.g. cron-job.org) open `https://nexraah-internal-api.onrender.com/api/v1/health` every **10 minutes**. The free allowance keeps one server awake all month, not two: ping only `nexraah-internal-api`; the transporter side may sleep and wakes in about a minute. A paid Render plan (Starter, ~$7 a month a server) makes this step unnecessary.

### 8 · Vercel — switch the websites over

**Console project** → Settings → Environment Variables (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_USE_MOCKS` | `0` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://nexraah-internal-api.onrender.com/api/v1` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key |
| `NEXT_PUBLIC_DEMO_DATA` | delete it |
| `SIGNIN_SECRET`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` | keep — Control → Integrations keeps its settings with these |

**Transporter portal project:** `NEXT_PUBLIC_MOCK=0`, `NEXT_PUBLIC_API_BASE_URL=https://nexraah-vendor-api.onrender.com/api/v1`, and the same two `NEXT_PUBLIC_SUPABASE_*` values.

Then **redeploy both** — `NEXT_PUBLIC_*` values are built into the site, so a change does nothing until the next deployment (see the trap below).

### 9 · Try it

1. Console: sign in with an `ADMIN` email from `staff.json` — the code should arrive within a minute. Control panel → Company details should read NEXUS FREIGHT PRIVATE LIMITED.
2. Add a client, raise a load request, enter a quote — then sign in as another desk on another device and see the same load.
3. Transporter portal: sign in with a transporter's mobile number and printed password.

### What changes when you switch

- **One set of data for everyone.** The demo records and anything typed into a browser while on demo data are not carried over — start from your real clients and transporters.
- **Fetch** still reads documents free, in the browser.
- **The Ask assistant** answers from records only on the demo data; on the real backend it says it is not set up unless `ANTHROPIC_API_KEY` is given (paid).
- **To go back** to demo data at any time: `NEXT_PUBLIC_USE_MOCKS=1` on the console and redeploy.

### Known limits

- A transporter who withdraws a quote cannot quote again on the same load (`portal-loads.service.ts` — one quote per transporter per load, a withdrawn one included).
- Transporter logins are made by `provision.mjs`, not when a transporter is cleared in the console (FLOWS.md §12).

See [`docs/specs/internal-spec/14-supabase-setup.md`](docs/specs/internal-spec/14-supabase-setup.md) for why the database is set up this way.

---

## One trap that will cost you an afternoon

`NEXT_PUBLIC_*` variables are **baked into the browser bundle at build time**,
not read at runtime. Changing one in the Vercel dashboard does nothing until you
redeploy. If a portal is behaving as though a flag has the wrong value, it does
— the build it is serving was made with the old one. Redeploy, don't debug.

## And one that will cost you an hour, if you build locally first

Both apps build clean — verified. But if you run `pnpm build` on your own
machine **while a `next dev` server is still running**, the console's build
fails partway through with something like:

```
✓ Compiled successfully
PageNotFoundError: Cannot find module for page: /print/pnl
Error: Failed to collect page data for /print/pnl
```

The named page is a red herring — it exists, and it is a different page each
time. The dev server is holding `.next` while the production build writes into
it, and the two use incompatible layouts. Don't go looking at the page.

Either stop the dev server, or give the build its own directory:

```powershell
$env:NEXT_DIST_DIR = '.next-prod'    # internal-portal's next.config honours this
pnpm --filter internal-portal build
```

If it has already happened, delete `.next` and build again. **None of this
affects Vercel** — every build there starts in a clean container.

> Use `.next-prod` and not `.next-build`. Both work as build directories, but
> `.gitignore` lists `.next` and `.next-prod` only — `.next-build` is **tracked**,
> and building into it puts a few hundred generated files into `git status`.
