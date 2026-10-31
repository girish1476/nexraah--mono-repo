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

**Also checked, 29 Oct 2026, with the website itself in real mode against that
database** (signed in through a stand-in for Supabase Auth): all 37 screens open
for an administrator; `supabase/tests/grants.sql` passes in full and a
transporter login reading client data is refused; a file uploads, opens through
its 15-minute link and refuses a link that was altered. That run found and fixed
three things the steps below depend on — an administrator was refused My desk,
All orders and the payment screens (`indent.view` and fifteen other permissions
were never granted in the database); three tables lacked `created_at`, so
`grants.sql` failed; and **no upload could have worked** on a hosted project,
because a private bucket refuses the anon key. Files now go through Storage's
S3 keys (step 3b).

### What you will create

| Service | What for | Free tier — and its catch |
|---|---|---|
| **Supabase** | The database, staff and transporter sign-in, file storage | 500 MB database, 1 GB files. A free project is paused after about a week with no use — daily use keeps it awake. |
| **Render** | The two backend servers (`render.yaml`) | Free, but a server sleeps after ~15 idle minutes. See step 7. |
| **Brevo** *(or Resend)* | Sending the sign-in code emails | Brevo: 300 a day, no domain needed — the sender address is verified by a link (the console already uses one). Resend: 3,000 a month, needs a domain you can add DNS records to. |
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

It applies the 67 migrations in `supabase/migrations`. **Do not run `supabase/seed.sql`** — that is made-up test data.

Then check the database's security — the transporter login, the money columns, and each role's permissions against the API's role table:

```powershell
node supabase/scripts/check-grants.mjs --db-url "<the same session pooler string>"
```

Every line must be ✓. If one is ✗, stop: it says which grant is wrong. Your company's details (NEXUS FREIGHT PRIVATE LIMITED, GST 37AAKCN9322K1ZY, the Gajuwaka address) are set by the migrations; correct anything else in Control panel → Company details once signed in.

### 3 · Supabase — logins, storage and people

1. `pnpm install` once at the repository root.
2. Copy `supabase/scripts/staff.example.json` to `staff.json` and list your staff: name, work email, role (`ADMIN`, `OPS`, `COMPLIANCE`, `FINANCE`, `BD`, `LEADERSHIP`). At least one `ADMIN`.
3. Copy `supabase/scripts/transporters.example.json` to `transporters.json` for transporters who will use the portal: their email and their transporter code (`VND-…`). One email per transporter, and not a staff member's. Transporters added later in the console can be added here and the script run again.
4. Make two strong passwords for the database logins and run:

```powershell
$env:INTERNAL_API_DB_PASSWORD = "<password 1>"
$env:VENDOR_API_DB_PASSWORD   = "<password 2>"
node supabase/scripts/provision.mjs --db-url "<the same session pooler string>" `
  --staff supabase/scripts/staff.json --transporters supabase/scripts/transporters.json
```

It must end with four ✓ checks and `Done.` It prints a temporary password for each new login: staff sign in with an emailed code (the password is not used); each **transporter** signs in to the portal with their email and the password printed beside it — give it to them privately. Delete `staff.json` and `transporters.json` afterwards, or keep them out of the repository.

### 3b · Supabase — the key for uploaded files

Storage → **S3 Connection**: switch *Enable connection via S3 protocol* on, then **New access key**. Note:

- the **Endpoint** shown there — `https://<ref>.storage.supabase.co/storage/v1/s3`
- the **Region** — `ap-south-1` for Mumbai
- the **Access key ID** and **Secret access key** (the secret is shown once)

These keys open the file bucket and nothing else. Do not use the `service_role` key instead — it opens the whole database.

### 4 · The sign-in emails — Brevo (or Resend)

**Brevo** (no domain needed): the API key and verified sender the console already uses work here — Brevo → SMTP & API → API keys, and the sender verified under Senders, e.g. `Nexraah <no-reply-nexraah@gmail.com>`. In Brevo → Security → Authorized IPs, leave IP blocking **off**: Render's servers send from addresses that change.

**Resend**, if you have a domain: sign up at resend.com, add the domain and the DNS records it shows, wait until *Verified*, create an API key, and decide the sender, e.g. `Nexus Freight <no-reply@yourdomain.in>`.

With `BREVO_API_KEY` set the sign-in codes and the notification emails go through Brevo; otherwise through Resend.

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
| `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` | from step 3b (`STORAGE_S3_REGION` is preset to `ap-south-1`) |
| `BREVO_API_KEY` *or* `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | from step 4 — fill one key, leave the other empty |
| `SEND_EMAIL_HOOK_SECRET` | leave empty for now — step 6 gives it |
| `PORTAL_PUBLIC_URL`, `CONSOLE_PUBLIC_URL` | the two websites' addresses — links in notification emails open these |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | run `node supabase/scripts/push-keys.mjs` once and paste its two lines — free browser notifications. Make the pair once: a new pair means everyone turns notifications on again |
| `VAPID_SUBJECT` | `mailto:` and an address of yours, e.g. `mailto:ops@yourdomain.in` — push services contact it if something is wrong |
| `ANTHROPIC_API_KEY` | leave empty (paid; without it, Fetch reads documents free in the browser and Ask answers from the records by rule) |
| `CORS_ORIGIN` (vendor-api) | the transporter portal's address, e.g. `https://nexraah-mono-repo-vendor-portal.vercel.app` |

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
3. Transporter portal: sign in with a transporter's email and printed password.

### Notifications — email and browser, free

Once `RESEND_API_KEY` and the `VAPID_*` values are set, the server tells people about what needs them, every minute:

| What happened | Who hears |
|---|---|
| A load is awarded | the transporter |
| Advance or balance paid | the transporter |
| Proof of delivery due in 5 days, overdue (weekly), close to forfeiting the balance — 09:00 each morning | the transporter |
| POD rejected, bill queried | the transporter |
| Transporter cleared | the transporter |
| An approval is waiting | everyone who can decide it |
| An approval is decided | the person who asked for it |

- **Email** goes to the transporter's *Email for notices* (transporter page → Add) and to staff sign-in emails.
- **Browser notifications**: transporters turn them on in the portal under **Profile → Notifications on this phone**; staff with the **bell** beside the dark-mode switch. Each phone or computer is turned on separately. On iPhone, the portal must first be added to the Home Screen (Share → Add to Home Screen) — Apple allows notifications only there.
- The demo shows neither: it has no server to send from.
- **SMS** is not connected — it costs per message and needs DLT-registered templates. Tell us the gateway (MSG91, Kaleyra, Gupshup…) and it can be added beside these.

### What changes when you switch

- **One set of data for everyone.** The demo records and anything typed into a browser while on demo data are not carried over — start from your real clients and transporters.
- **Fetch** still reads documents free, in the browser.
- **The Ask assistant** answers from the shared records by rule — a truck or order number, what is waiting today, what clients owe, approvals and the like. With `ANTHROPIC_API_KEY` (paid) it answers anything the records can.
- **GPS tracking, the accounting export and the bank statement check** work on the real backend as on the demo: set the GPS device key under Control → Integrations again after switching.
- **To go back** to demo data at any time: `NEXT_PUBLIC_USE_MOCKS=1` on the console and redeploy.

### Known limits

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
