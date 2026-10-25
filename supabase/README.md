# Hosted booking backend

For a **new project**, apply the migrations in order: `202610240001_booking_platform.sql`,
`202610240002_owner_calendar.sql`, `202610240003_admin_billing.sql`, then
`202610250004_salon_photos.sql`, then `202610250005_booking_alerts.sql`, using
`supabase db push` after linking the project or the privileged SQL Editor.
For an **existing project with the original booking tables**, apply missing upgrades in order: **002, 003, 004, 005**.
If the administration/calendar upgrade is already installed, apply **004 only** for photo uploads.
If photo uploads are already installed, apply **005 only** for signup mobiles and booking alerts.
Never rerun 001, delete tables, or reset the project to install these additions.
The additive upgrades can be reapplied. Production migrations do not create
sample businesses or accounts.
`tests/bootstrap.sql` is **only** for the isolated local PostgreSQL test container.

Enable email/password Auth and confirmed-email signup in Supabase. Configure the
site URL and allowed redirect URLs for the real website. The browser receives
only the project URL and its publishable/anon key. Never put a service-role key,
Resend key, or worker secret in `VITE_*`, `public/`, or the website configuration.

## Administrator access and business review

Business owners create drafts, choose a supported city, enter staff, services and
weekly hours, then submit for review. Use the website's `/#admin` route to review
pending businesses, approve or reject requests with a review note, and view real
platform statistics. Only a verified account with trusted
`auth.users.raw_app_meta_data.role = 'admin'` can use these operations. Neither
an email comparison in the browser nor user-editable profile metadata grants access.

Create and verify the administrator's normal website account first. Then run
[`activate-admin.sql`](activate-admin.sql) in the privileged SQL Editor after replacing
its email placeholder. It requires exactly one verified account, preserves its
other metadata, and cannot be invoked by browser users. Sign in again or choose
**Ανανέωση πρόσβασης** on the admin page to refresh the session claim. Never share
SQL Editor access, service credentials or passwords with business owners.

The admin review checks the actual owner, contact details, services, staff and
hours. A business must have a usable service/staff/hours setup before approval.
No fictional listing is published by installation. Owners choose an actual salon
photograph from their device, see its preview, then save it through the business settings.

## Salon photo uploads

Apply [`migrations/202610250004_salon_photos.sql`](migrations/202610250004_salon_photos.sql)
once in the existing project's privileged SQL Editor. It is safe to rerun and does
not delete salons, bookings, existing images or unrelated Storage buckets/policies.
Do not rerun the initial booking installer. Supabase must already supply its managed
`storage.buckets` and `storage.objects` tables; the migration does not recreate them.

The `salon-photos` bucket is public and accepts JPEG, PNG or WebP images up to
5 MiB. Images are intentionally viewable by their public URL, including a draft
business's uploaded image; do not upload private customer or identity photographs.
Storage's API enforces the bucket MIME/size settings. The browser validates image
decoding and shows the local preview before upload, but preview alone is not a save.

Object names use `<salon UUID>/<random UUID>.<jpg|jpeg|png|webp>`. Insert, update,
delete and metadata listing require the actual verified salon owner. Paths cannot
be moved to another salon, and administrator status alone does not grant upload
access to an unrelated business. Public delivery of an image uses the public
Storage URL, while anonymous users cannot list the bucket's object metadata.
Bucket-scoped restrictive guards also prevent a pre-existing broad Storage policy
from bypassing these checks without changing permissions for unrelated buckets.

The app uploads a new object, then saves its HTTPS public URL in `salons.image_url`.
Owners do not need to enter or host an image URL themselves. A failed upload does
not change the existing salon photograph. Card billing and appointment email
settings are unrelated to this Storage upgrade.

Generate a complete copy/paste script, including read-only installation checks:

```sh
node scripts/package-photo-upgrade.mjs /workspace/artifacts
```

`bash scripts/test-photo-storage.sh` validates the exact packaged script in an
isolated local Postgres container, including ownership policies, unsupported paths
and repeated installation preserving existing objects/settings. The local Storage
tables are test-only approximations; a hosted upload/download acceptance check is
still required after applying the upgrade. Never apply `tests/bootstrap.sql` to a
hosted project.

## Shared owner calendar

The business calendar can create and edit appointments received by phone, in
person or elsewhere. These are server-saved `booking_source = 'offline'` records
in the same bookings table as online appointments. A confirmed offline interval
immediately blocks online availability for that staff member. Moving or cancelling
it frees the old interval. Database exclusion also protects against simultaneous
online and owner requests; refreshing a consumer's slot list never overrides it.

Manual entries require the verified salon owner and active service/staff belonging
to that salon. They may include contact details, notes and an agreed price/duration.
They do not create or impersonate a customer account and do not send automatic
customer email. Existing online bookings retain their agreed terms when rescheduled.

## Monthly business subscriptions

The **Μηνιαίες συνδρομές** admin tab configures the monthly euro price and offer;
no price or payment account is supplied by migration. It also supports manual
subscription and charge records. Marking a manually received payment as paid is
an accounting record, **not a bank transfer, card charge or tax receipt**. Owners
see their own subscription and charges under **Η συνδρομή σας**.

Automatic recurring card collection is a separate, server-only Stripe integration.
Follow the [checkout activation guide](functions/create-subscription-checkout/README.md)
and [signed webhook guide](functions/stripe-webhook/README.md): connect the operator's
Stripe account, configure private Edge Function secrets, deploy both functions,
configure the webhook/portal, then verify the full workflow in Stripe test mode.
The interface shows that card payment is unavailable when these are not ready.
Only signed provider events confirm card payments; returning from checkout cannot
mark an invoice paid. Consumers still pay their salon for their appointment.

Prices are integer euro cents. Durations are 5–480 minutes in 5-minute steps; slots
start every 15 minutes. Booking identity, verified email, duration, price, venue,
country, time zone, staff name and cancellation policy are server snapshots.
Rescheduling retains the original price/duration/policy. Customers can hold at
most 20 future confirmed appointments. Staff interval exclusion prevents double
bookings even under concurrent transactions. Schedule changes cannot invalidate
future confirmed appointments, and time off cannot overlap them. Owners can
override the customer cancellation cutoff. Only the owner can record completed customer payment
at the venue, after the appointment has started. Customer card charges are not implemented.
Business subscription collection is separate and requires the Stripe activation above.

## Email outbox

Online booking, cancellation and rescheduling enqueue a private notification in the same
transaction. A failed email never undoes an accepted booking. To enable delivery:

1. Verify a sending domain with Resend and choose its sender address.
2. Configure **server-side Supabase Edge Function secrets** `RESEND_API_KEY`,
   `NOTIFICATION_FROM` (for example `Your Salon <appointments@your-verified-domain>`),
   and a random `NOTIFICATION_WORKER_SECRET` of at least 32 characters. Supabase
   supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime.
   Enter actual values only into the provider's secure settings/CLI; never commit
   them or paste them into chat.
3. Deploy `process-notifications` with `supabase functions deploy process-notifications`.
   `config.toml` disables the legacy JWT gateway for this endpoint because the
   handler requires its custom bearer secret on **every** call.
4. Use a trusted scheduler to POST to
   `https://<project-ref>.supabase.co/functions/v1/process-notifications` every minute,
   with `Authorization: Bearer <NOTIFICATION_WORKER_SECRET>` retrieved securely.
   Store scheduler credentials in a secrets manager or Supabase Vault. Do not
   hardcode credentials into SQL migration, the browser, or a public webhook.

The worker also enqueues customer-only reminders approximately 24 hours before
the appointment (23h45–24h15 window). Each booking/start gets one reminder;
cancellation or rescheduling invalidates unsent reminders, and the worker checks
that each reminder still refers to the current confirmed appointment before
sending. The trusted scheduler must run at least every five minutes to cover
this window; appointments created inside 23h45 of their start do not get a
24-hour reminder. Reminder delivery is subject to provider availability.

The worker sends separate customer and business-owner messages, never exposing
one recipient's address to the other. Resend idempotency keys distinguish each
outbox event and recipient. Failed attempts retry after 5–25 minutes (up to five
attempts), with stale processing locks reclaimed after ten minutes. Provider
idempotency lasts 24 hours; investigate failed rows before replaying older events.
No delivery has been verified until real provider credentials/domain and a
scheduler are configured and a real message is received. Confirmation emails from
Supabase Auth are separate from these appointment notifications.

Administrators can inspect `private.notification_outbox` in SQL. Browser roles
cannot read it, call the queue worker RPCs, or forge payment status. The service
role alone can call `claim_notifications` and `ack_notification`. Requeue a failed
message only after correcting its underlying provider/configuration issue.

## Validation

Run `bash scripts/test-database.sh` from the repository. It uses official
PostgreSQL 17 in a disposable Docker container with no published network port,
loads the **exact** ordered production migrations, and validates ownership/RLS, verified
email, prices and snapshots, availability/hours/time off, cancellation/reschedule,
payment authority, outbox enqueueing/worker authorization, two concurrent booking
sessions, concurrent idempotent retries, the database exclusion constraint,
reminder idempotency/stale-event handling,
manual/online conflicts and edits, administrator authorization, business review,
subscription pricing, invoice integrity and signed-provider event ordering.
No hosted project, test-account passwords or host `psql` are required. It removes
its own container automatically and leaves existing containers untouched.

The edge worker has isolated mocked-provider tests in
`functions/process-notifications/index_test.ts`; run
`deno test --allow-env supabase/functions/process-notifications/index_test.ts`.
These verify authorization, private recipient handling, reminders, idempotency and failure
acknowledgments, not actual email delivery. Hosted Supabase Auth/PostgREST and live
email delivery still require deployment verification with the real project.

The subscription functions have isolated mocked-provider tests:

```sh
deno test --allow-env supabase/functions/create-subscription-checkout/index_test.ts supabase/functions/stripe-webhook/index_test.ts
```

These tests never create live Stripe sessions or charge businesses. To reproduce
a single copy/paste upgrade for an existing project, run:

```sh
node scripts/package-admin-upgrade.mjs /tmp/eneres-upgrade YOUR_VERIFIED_ADMIN_EMAIL
```

The generated SQL includes only 002 and 003 plus an optional verified-account
role grant. If the account is absent/unconfirmed, the schema still upgrades and
reports **ACTION NEEDED** for administrator activation. The file contains no
passwords or private provider credentials.

To test that exact package against an original populated installation, including
repeated application, preservation of existing bookings and verified-only grants:

```sh
bash scripts/test-admin-upgrade.sh /tmp/eneres-upgrade/eneres-admin-calendar-upgrade.sql YOUR_VERIFIED_ADMIN_EMAIL
```

This uses another disposable local PostgreSQL container and never contacts the
hosted project or sends an email.

## Signup mobiles and business booking alerts

Apply `migrations/202610250005_booking_alerts.sql` after the earlier upgrades. The SQL Editor package can be generated with `node scripts/package-booking-alerts-upgrade.mjs /workspace/artifacts`; the exact package is tested with `bash scripts/test-booking-alerts-upgrade.sh`. It is additive and safe to rerun.

New email accounts supply a canonical country-coded mobile in Auth metadata `mobile_phone`. Server triggers validate it and create the private profile contact; older profiles keep their existing numbers or remain null. Country-code controls and booking forms validate the input, while the server remains authoritative. These numbers are not claimed to be SMS verified. Legacy accounts can add a number in their profile or booking form.

`create_booking_with_contact` creates an online booking with required phone and optional notes in the same transaction as its business alert and private email queue entry. The older booking RPC remains compatible with cached clients. The owner-only inbox supports paginated history and a global unread count. Acknowledgement records that the business has seen the already-confirmed booking; it does not create or approve a second reservation. Cancellation requires a reason and atomically updates the booking, frees online availability, stores history and makes the reason visible to that customer.

Dashboard notifications poll every15 seconds while visible and refresh on focus. They are not browser push notifications. Background email requires the existing private worker and sender configuration; publishing the frontend or applying SQL alone does not send email. Redeploy the updated `process-notifications` worker to include customer contact and cancellation explanations in emails. No real emails or live accounts are created by the tests.
