# Hosting the stakeholder demo

This is the runbook for putting Nexraah in front of people who need to click
through it — not a production deployment. Read [what this is not](#what-this-is-not)
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

Open each URL. The console should land on `/signin`; the transporter portal on
its Loads tab.

---

## Signing in to the demo

The sign-in screen lists the six accounts. The password for all of them is:

```
nexraah
```

| Role | Account | Lands on |
|---|---|---|
| Operations | anil@nexraah.in | Today's queue |
| Compliance | meera@nexraah.in | Compliance desk |
| Finance | rakesh@nexraah.in | Payments → Balance |
| Branch manager | sunita@nexraah.in | Today's queue, Nashik only |
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
- **The transporter side is read-only in production anyway.** Quote submission,
  delivery-note upload and billing are not built yet on the real backend, so
  the demo shows more than production currently does. Do not promise those.
- **Two decisions are still open** and both are visible in the demo: transporter
  logins are not created on activation (see [`FLOWS.md`](FLOWS.md) §12), and
  whether a losing transporter is told why they lost is contradicted between the
  spec and the built portal.

---

## Turning this into real staging later

Not a bigger version of the above — a different deployment. What changes:

1. **A Supabase project**, with `supabase/migrations` applied and
   `supabase/seed.sql` run. The seed creates an auth account per internal user
   and links `users.auth_user_id`; without that link a sign-in succeeds and then
   fails with *"This principal holds no internal role."*
2. **Both backends hosted** — `internal-api` and `vendor-api` are NestJS
   services and need a Node host (Render, Railway, Fly). Vercel is the wrong
   shape for them.
3. **`internal-api` gets two database URLs**, one per role — `internal_api` and
   `vendor_api`. That split is what makes a transporter-facing query reaching
   for a client name fail at the database.
4. **`vendor-api` gets no database URL and no Supabase key of any kind.** A
   credential landing in that service voids the redaction boundary. Its own
   `.env.example` says so; treat it as a deployment invariant.
5. **`PORTAL_SERVICE_KEY`** — 32 random bytes, identical in both API services.
6. **Flip both flags off**: `NEXT_PUBLIC_USE_MOCKS=0`, `NEXT_PUBLIC_MOCK=0`, and
   set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` on the
   console. They must point at the same Supabase project `internal-api`
   validates against, or every token is rejected as the wrong issuer.

See [`docs/specs/internal-spec/14-supabase-setup.md`](docs/specs/internal-spec/14-supabase-setup.md)
for the database side.

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
