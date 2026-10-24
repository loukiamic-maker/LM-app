# Hosted booking backend

Apply `migrations/202610240001_booking_platform.sql` to a new Supabase project using
`supabase db push` after linking the project, or execute the exact migration in its
SQL editor. Production migrations do not create sample businesses or accounts.
`tests/bootstrap.sql` is **only** for the isolated local PostgreSQL test container.

Enable email/password Auth and confirmed-email signup in Supabase. Configure the
site URL and allowed redirect URLs for the real website. The browser receives
only the project URL and its publishable/anon key. Never put a service-role key,
Resend key, or worker secret in `VITE_*`, `public/`, or the website configuration.

Business owners create drafts, enter staff, services and weekly hours, then submit
for review. An administrator reviews the actual business and publishes it through
Supabase's privileged SQL editor:

```sql
-- Replace the ID with the reviewed business. Never run this for demo data.
update public.salons set status = 'published' where id = '<reviewed-salon-uuid>';
```

Alternatively, a trusted server can use a service-role JWT, or an administrator
can have `auth.users.raw_app_meta_data.role = 'admin'` assigned by an existing
privileged administrator. User-editable Auth metadata never grants admin rights.
Do not expose these administrative credentials to a salon owner or customer.

Prices are integer euro cents. Durations are 5–480 minutes in 5-minute steps; slots
start every 15 minutes. Booking identity, verified email, duration, price, venue,
country, time zone, staff name and cancellation policy are server snapshots.
Rescheduling retains the original price/duration/policy. Customers can hold at
most 20 future confirmed appointments. Staff interval exclusion prevents double
bookings even under concurrent transactions. Schedule changes cannot invalidate
future confirmed appointments, and time off cannot overlap them. Owners can
cancel within the customer cutoff. Only the owner can record completed payment
at the venue, after the appointment has started. No online charge is implemented.

## Email outbox

Booking, cancellation and rescheduling enqueue a private notification in the same
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
loads the **exact** production migration, and validates ownership/RLS, verified
email, prices and snapshots, availability/hours/time off, cancellation/reschedule,
payment authority, outbox enqueueing/worker authorization, two concurrent booking
sessions, concurrent idempotent retries, and the database exclusion constraint, and reminder idempotency/stale-event handling.
No hosted project, test-account passwords or host `psql` are required. It removes
its own container automatically and leaves existing containers untouched.

The edge worker has isolated mocked-provider tests in
`functions/process-notifications/index_test.ts`; run
`deno test --allow-env supabase/functions/process-notifications/index_test.ts`.
These verify authorization, private recipient handling, reminders, idempotency and failure
acknowledgments, not actual email delivery. Hosted Supabase Auth/PostgREST and live
email delivery still require deployment verification with the real project.
