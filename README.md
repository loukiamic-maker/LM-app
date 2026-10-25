# Eneres

Greek beauty and wellness booking website for Greece and Cyprus, with the supplied floral logo and **payment at the salon**. The existing public address is https://loukiamic-maker.github.io/LM-app/.

The website is configured for the owner's **real Supabase project**. The owner has confirmed all eight installation verification checks pass, and the real public directory and confirmed-email settings respond successfully. The directory has no published salons yet. Email delivery, real customer/owner booking flows and operator details still need completing before inviting customers. Example businesses and local demo bookings are never imported into the live database.

The chosen future website address is **eneresbeauty.com**, while the visible brand remains Eneres. Verisign RDAP currently reports no registration record for that address; registrar availability, price and registration are still pending. It has not been purchased or connected. `eneres.com` is already registered, and trademark clearance remains unverified.

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
2. Apply the SQL migrations in order using the project's SQL Editor. An existing installation needs only the additive upgrades it has not yet installed (`002` and `003` for administration/calendar, `004` for photo uploads); do not repeat the initial `001` installer. Never apply the test bootstrap to a hosted project.
3. Configure confirmed email/password Auth and the permitted website redirect URLs.
4. Put only the public Project URL and publishable/anon key into `public/platform-config.js`, or use `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` when building. The build rejects privileged keys and credential-bearing URLs. Never publish a service-role key, database password or email-provider secret.
5. Configure the private notification worker, verified email sender and scheduler as described in [the backend guide](supabase/README.md).
6. Create the first real business through the owner dashboard, add services, staff, hours and photos, submit it for review, then approve it as administrator.
7. Verify hosted signup, login, booking, notifications, cancellation/rescheduling and business access. Add the real operator's privacy/contact/terms information before public commercial launch.

The application includes customer signup/verification/login/password recovery, server-confirmed bookings, customer history/cancellation/rescheduling, owner onboarding and catalogue/schedule/time-off management, and manual records of payments received **at the salon**. Businesses can add and edit offline appointments in their shared calendar; those appointments block overlapping online availability immediately after a successful database save.

Business settings include a device photo picker and listing preview. Apply the additive `202610250004_salon_photos.sql` migration to enable the public `salon-photos` Storage bucket. Only a verified salon owner can manage files in that salon's folder; JPG, PNG and WebP images are limited to 5 MB. Selecting a file previews it locally; saving uploads it and updates the shared listing. Owners do not need to supply a website address for their photograph.

The administrator dashboard is at [`/#admin`](https://loukiamic-maker.github.io/LM-app/#admin). It provides business approval, statistics, a configurable monthly subscription price and billing records. Access requires a confirmed account granted the trusted administrator role through the project's SQL Editor; an email address alone never grants access. See [`supabase/activate-admin.sql`](supabase/activate-admin.sql) and the upgrade instructions in [the backend guide](supabase/README.md).

Server functions for Stripe-hosted monthly **business subscriptions** are supplied, but require the operator's Stripe account, private server settings, deployed functions and signed webhook before accepting card payments. No live payment connection is implied by deploying the website. Customer appointments continue to be paid at the salon.

Date searches check the real availability RPC for active services before showing
matching salons. Each search limits requests to four at a time, stale results are
ignored, and a failed check shows a retry message instead of false availability.

Production builds load a content-versioned public configuration file. Missing or
invalid configuration shows a connection error instead of fictional listings.
Only an explicit pair of blank runtime settings enables isolated demo checks.

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
