# Connect Eneres to real bookings

Eneres includes a hosted Supabase backend for customer accounts, business ownership, availability and **payment at the salon**. No card or Apple Pay charge is implemented.

The public website remains a demo while both values in `public/platform-config.js` are empty. Demo appointments stay in that browser and are never imported into the real database. Entering a valid public project configuration switches the website to live mode; it does not create the database, publish a business or enable email delivery. Complete the database steps first.

The name Eneres and its flower artwork are the current branding. Ownership of an Eneres domain and trademark availability have not been confirmed; cloud network restrictions prevented completing authoritative registry checks. Keep the current website address until those checks are complete. See [the custom-domain guide](custom-domain.md).

## 1. Create an EU Supabase project

1. Sign in at [supabase.com/dashboard](https://supabase.com/dashboard) and create a project for Eneres.
2. Choose an available **EU region**, such as Frankfurt, appropriate for your operating requirements.
3. Generate a strong database password and keep it in your password manager. It is an administrator credential; it does not go in this website, GitHub, or chat.
4. Wait until the project is running. Record its project reference and project URL from the project settings.

Use a new, empty project for the initial migration below. A project used by another application needs a separate migration review.

## 2. Create the database

In the project's **SQL Editor**, open a new query, paste the complete contents of this repository file, and run it once:

[`supabase/migrations/202610240001_booking_platform.sql`](../supabase/migrations/202610240001_booking_platform.sql)

Use the normal privileged SQL Editor connection for project administration. The migration creates the application tables, ownership rules, booking transactions, double-booking constraints and private notification queue. It does not create example salons or customer accounts.

**Do not run `supabase/tests/bootstrap.sql` in the hosted project.** That file is only for the isolated local database test runner. Do not copy browser test fixtures into production either.

After the migration succeeds, this read-only query should return table names in every column:

```sql
select
  to_regclass('public.profiles') as profiles,
  to_regclass('public.salons') as salons,
  to_regclass('public.staff') as staff,
  to_regclass('public.services') as services,
  to_regclass('public.staff_hours') as staff_hours,
  to_regclass('public.staff_time_off') as staff_time_off,
  to_regclass('public.bookings') as bookings,
  to_regclass('private.notification_outbox') as notification_outbox;
```

Keep the successful query as a named migration record. If the migration reports an error, preserve the exact error and resolve it before connecting the public website. Do not repeatedly rerun this initial migration or delete tables containing real data to work around an error.

## 3. Configure account emails and callback URLs

In Supabase **Authentication**, enable email/password accounts and keep **Confirm email** enabled. Customers must confirm their email before making a real booking.

Under **Authentication → URL Configuration**, use the website's current address:

| Setting | Value |
| --- | --- |
| Site URL | `https://loukiamic-maker.github.io/LM-app/` |
| Allowed Redirect URL | `https://loukiamic-maker.github.io/LM-app/` |

The trailing `/LM-app/` path matters. This app uses that address for email confirmation and password recovery. Add `http://localhost:5173/` only if you intentionally test local development against this project; it is not the public website address.

When you own and activate a custom domain, set Site URL to its HTTPS root and add that exact root as an allowed redirect. Build that release with `--base=/` and follow [the domain guide](custom-domain.md). Do not configure an unowned candidate domain as the production callback.

Configure **custom SMTP** in Supabase Auth before inviting the public. Supabase's default email service has recipient and rate restrictions and is unsuitable for general production signup. Use an email provider and a sender domain you control, enter its SMTP credentials only in Supabase's secure Auth settings, and test both confirmation and password recovery. These account emails are separate from appointment notifications in step 7.

## 4. Add the public browser configuration and deploy

In the project API settings or Connect panel, copy:

- The project URL, for example `https://YOUR_PROJECT_REF.supabase.co`.
- The **publishable** key, normally beginning `sb_publishable_`. A legacy `anon` key is also supported.

Edit [`public/platform-config.js`](../public/platform-config.js):

```js
window.MERAKI_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabasePublishableKey: 'YOUR_SUPABASE_PUBLISHABLE_KEY',
};
```

Replace the example strings with this project's public settings. `MERAKI_CONFIG` is the existing technical configuration name; keep it unchanged even though the visible brand is Eneres.

The URL and publishable key are intended to be visible in the browser. Access to private data comes from authenticated sessions and the database's row-level security. **Never put a `service_role` key, `sb_secret_…` key, database password, SMTP password, Resend API key or notification-worker secret in this file, `public/`, `VITE_*`, or a frontend build.**

Build the current GitHub Pages version from the repository root:

```sh
npm ci
npm run build -- --base=/LM-app/
```

Deploy the new contents of `dist/` through the repository's existing GitHub Pages deployment process. Editing the source file alone does not update the public website. Open `https://loukiamic-maker.github.io/LM-app/`, reload, and check that the demo directory has been replaced by the real directory. An empty real directory is expected before a real business is approved.

If the site reports a connection or configuration error, check the project URL, publishable key, migration result, project availability and deployed build. A valid-looking key does not prove the hosted database is ready.

## 5. Create the first real business

Use the website's **Για επαγγελματίες** entry:

1. Create the actual owner's account and confirm its email.
2. Enter the real business name, country, city, category and complete address. This creates a private draft owned by that account.
3. In **Υπηρεσίες**, add real services with their euro prices and durations.
4. In **Ομάδα & ωράριο**, add the actual professionals and their weekly hours. A day with no intervals is closed; two intervals can represent a lunch break.
5. Add holidays or other absences as needed. Hours use `Europe/Athens` for Greece and `Europe/Nicosia` for Cyprus. Schedule changes that would invalidate accepted appointments are rejected rather than silently dropping them.
6. In **Η επιχείρησή μου**, check the description, address and cancellation policy. The default customer cancellation/change cutoff is 24 hours before the appointment; an owner can cancel after that cutoff.
7. Choose **Υποβολή για έλεγχο**. The business becomes `pending`; the owner cannot self-publish.

Do not publish the fictional businesses, prices, reviews or generated salon pictures from the demo as actual trading businesses. Live mode does not seed or migrate them.

## 6. Review and publish the real listing

The platform administrator reviews the actual business, its owner/contact details, address, services, prices, working hours, cancellation policy and permission to use its photographs. The current owner interface does not upload salon photographs; the administrator can set an authorized, publicly accessible HTTPS photograph in `public.salons.image_url` during review. Generated category artwork is not evidence of a real salon's appearance.

In the Supabase SQL Editor, find pending listings:

```sql
select id, name, city, country, address, status
from public.salons
where status = 'pending'
order by created_at;
```

After verifying the selected business, replace the UUID below with that listing's actual ID and run:

```sql
update public.salons
set status = 'published'
where id = 'REPLACE_WITH_REVIEWED_SALON_UUID'::uuid
  and status = 'pending'
returning id, name, status;
```

The result must identify the intended business and show `published`. This is an administrator action; do not give project SQL access or an administrator key to salon customers or owners to make it possible. A normal owner session is deliberately unable to publish.

Reload the public website and verify that the listing appears with the intended address, services, prices and image. Then confirm that a real owner's calendar shows that owner's salon only.

## 7. Enable appointment notifications

Real booking, cancellation and rescheduling operations enqueue a private notification in the same database transaction. **A queued message has not necessarily been sent.** Notifications need an email provider, a deployed worker and a private scheduler.

1. Create an account with [Resend](https://resend.com/) and verify a sending domain you own. Use the provider's exact DNS records. Do not assume `eneres.com` is available or verified.
2. In **Supabase Edge Function secrets**, securely enter these server-only values:

   | Name | Value to enter securely |
   | --- | --- |
   | `RESEND_API_KEY` | The actual Resend API key permitted to send email |
   | `NOTIFICATION_FROM` | A verified sender, such as `Eneres <appointments@YOUR_VERIFIED_DOMAIN>` |
   | `NOTIFICATION_WORKER_SECRET` | A newly generated random secret of at least 32 characters |

   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside the Edge Function runtime. Do not copy that privileged key into the website.

3. From the repository root, authenticate the Supabase CLI with the project administrator's account and deploy the supplied function:

   ```sh
   npx supabase login
   npx supabase functions deploy process-notifications --project-ref YOUR_PROJECT_REF
   ```

   [`supabase/config.toml`](../supabase/config.toml) sets `verify_jwt = false` for this function because its handler requires the custom `NOTIFICATION_WORKER_SECRET` bearer on every request. Keep that handler authorization check intact.

4. Configure a trusted server-side scheduler to send a **POST every minute** to:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-notifications
   ```

   It must send `Authorization: Bearer <NOTIFICATION_WORKER_SECRET>` and an empty JSON body. Enter the actual bearer only in the scheduler's secure secret settings. Do not put it in a browser request, GitHub source, public URL or committed SQL.

One supported scheduler is Supabase Cron with `pg_net` and Vault. Enable those integrations in the Supabase dashboard and securely create a Vault secret named `eneres_notification_worker` containing the same worker-secret value. The scheduled SQL can reference that secret without embedding its value:

```sql
select cron.schedule(
  'eneres-booking-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'eneres_notification_worker'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
```

Replace `YOUR_PROJECT_REF` before scheduling. Create this job once; use the Cron dashboard to inspect, edit or disable it. If your scheduler/Vault settings differ, use its documented secure-secret integration rather than replacing the Vault lookup with a hardcoded secret.

After a controlled real booking, verify receipt in both the customer's and the owner's inboxes and check the function's invocation results. An administrator can inspect delivery counts without displaying recipient information:

```sql
select status, count(*)
from private.notification_outbox
group by status
order by status;
```

The worker sends separate customer and owner emails, retries temporary failures, and records final failures for investigation. A successful booking is retained if email delivery fails. Fix the provider or scheduler issue before retrying failed messages. See [the backend operations guide](../supabase/README.md) for retry and idempotency details.

No real SMTP, sender domain, worker deployment, scheduler invocation or email delivery is confirmed merely by these instructions being present.

## 8. Verify the hosted workflow before inviting customers

Use accounts and a real participating business you control or have permission to test:

1. Confirm signup, email confirmation, sign-in, sign-out and password recovery from the public website.
2. Make an actual controlled pay-at-salon booking. Check that the customer sees its date, staff member, agreed price and payment-at-salon status; check that the owner sees the same booking on the correct local date.
3. Open a second browser session and confirm the reserved interval is unavailable. If a slot is taken during confirmation, the customer must get an error rather than a false success.
4. Test a permitted reschedule and cancellation. The server must preserve the original booking if rescheduling fails and enforce the customer's cutoff.
5. Check working-hour intervals and an absence against actual availability.
6. After a test appointment starts, use the owner calendar to complete it. Mark it paid only when the payment was actually received at the venue; this does not charge a card or generate a tax receipt.
7. Confirm customer and owner notification emails. Test with a second customer/owner account that private bookings and other owners' settings are inaccessible.

Repository database tests and mocked browser tests are useful checks, but they do not establish that your hosted Auth, project permissions, SMTP or email delivery work. Record these hosted results separately.

## Before a public launch

Add the actual platform operator's legal name, business/contact address and support email. Publish production privacy information covering hosted accounts and bookings, processors such as Supabase and the email provider, data retention, and how users exercise their rights. Publish customer and business terms, the pay-at-salon arrangement, cancellation/no-show policies and the division of responsibility between Eneres and participating salons. Demo-only local-storage explanations are insufficient for the hosted service.

Review those documents for the actual Greece/Cyprus business model and obtain authorization for business details and photos. Configure production email delivery, database backups/monitoring and a way to handle access/deletion/support requests. Finalize domain ownership and brand/trademark checks before advertising an unverified Eneres address or claiming exclusive rights to the name.

The launch is complete only after the real configuration is deployed, a reviewed business is published, the hosted booking/account checks pass, notification delivery is verified, and the operator's production policies are in place.
