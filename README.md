# Eneres

Greek beauty and wellness booking website for Greece and Cyprus, with the supplied floral logo and **payment at the salon**. The existing public address is https://loukiamic-maker.github.io/LM-app/.

The website runs in **demo mode until a real Supabase project is configured**. Example businesses and local demo bookings are never imported into the live database. The Eneres name and eneres.com remain provisional: registration and trademark availability have not been verified.

## Run locally

Requires Node.js20.19+ or22.12+ (tested with24), npm and the existing checkout:

```sh
cd /workspace/LM-app
npm ci
npm run dev
```

`npm run build` creates a root-hosted static site in `dist/`; `npm run preview` serves it for local checks. For this GitHub Pages project path use `npm run build -- --base=/LM-app/`. The public release lives on `gh-pages`, source on `codex/meraki-website`. Public hosting alone does not connect the database.

## Connect real accounts and bookings

Follow [the step-by-step launch guide](docs/go-live.md). In brief:

1. Create an owner-controlled Supabase project in an EU region.
2. Apply the exact SQL migration in `supabase/migrations/` using the project's SQL Editor. Never apply the test bootstrap to a hosted project.
3. Configure confirmed email/password Auth and the permitted website redirect URLs.
4. Put only the public Project URL and publishable/anon key into `public/platform-config.js`, or use `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` when building. The build rejects privileged keys and credential-bearing URLs. Never publish a service-role key, database password or email-provider secret.
5. Configure the private notification worker, verified email sender and scheduler as described in [the backend guide](supabase/README.md).
6. Create the first real business through the owner dashboard, add services, staff, hours and photos, submit it for review, then approve it as administrator.
7. Verify hosted signup, login, booking, notifications, cancellation/rescheduling and business access. Add the real operator's privacy/contact/terms information before public commercial launch.

The application includes customer signup/verification/login/password recovery, server-confirmed bookings, customer history/cancellation/rescheduling, owner onboarding and catalogue/schedule/time-off management, a shared business calendar, and manual records of payments received **at the salon**. No online card collection or card charges are implemented.

Postgres derives prices, durations, identity and email on the server. RLS isolates accounts/businesses; an exclusion constraint and transactions reject concurrent staff overlaps. Changes preserve agreed price/duration/cancellation snapshots. New business listings remain private until administrator approval. Private outbox delivery covers confirmations, changes, cancellations and reminders; actual email needs external provider configuration.

## Verify

```sh
npm test                  # Chromium: demo + mocked hosted API browser flows
npm run test:config       # rejects private keys and credential-bearing URLs
npm run test:database     # disposable official Postgres17 Docker container
```

Browser tests use `/usr/bin/chromium`, overridable with `CHROMIUM_PATH`. Database tests require Docker and use isolated test data, never production records. Worker tests and exact commands are documented in [supabase/README.md](supabase/README.md).

Passing local SQL and mocked HTTP tests does not prove that hosted Supabase Auth, SMTP, sender DNS, email delivery or a custom domain is configured. Those require real project configuration and a separate hosted acceptance run.

## Branding and domain

The floral asset in `public/images/eneres-flower.png` was prepared from the supplied logo; the website renders **Eneres** underneath. [Custom domain instructions](docs/custom-domain.md) explain ownership, DNS, HTTPS, the root build path and Auth redirect changes. No domain has been purchased or configured. Preserve the existing GitHub Pages address until the desired domain is verified and owned.

Legacy `meraki-*` browser-storage keys remain for demo compatibility only. Live bookings use the shared database and never treat local records as real appointments.

Cloud tasks are already isolated; use the existing checkout and do not create a worktree unless explicitly requested.
