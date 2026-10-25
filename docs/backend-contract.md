# Pay-at-salon backend contract

Hosted Supabase Postgres + Auth, existing static React website. Configured production uses the real directory and fails closed if settings are missing; isolated demo checks opt in explicitly. No service-role key or privileged credential in the browser. Published listings only in live marketplace; never seed example businesses into production.

## Database and security

Tables: `profiles(user_id,full_name)`, `salons(id,owner_id,name,category,city,country,address,description,timezone,photo_index,image_url,status,cancellation_hours)`, `staff(id,salon_id,name,active)`, `services(id,salon_id,name,duration_minutes,price_cents,active)`, `staff_hours(id,staff_id,weekday,opens_at,closes_at)`, `staff_time_off(id,staff_id,starts_at,ends_at,reason)`, `bookings(id,salon_id,service_id,staff_id,customer_id,salon_name,staff_name,country,timezone,cancellation_hours,starts_at,ends_at,customer_name,customer_email,service_name,price_cents,status,payment_method,payment_status,idempotency_key,created_at)`, private notification outbox.

One salon staff member may deliver all active services of that salon initially. Hours may have multiple non-overlapping intervals per weekday (0=Sunday); time off subtracts availability. Countries are Greek strings Ελλάδα/Κύπρος; timezone Europe/Athens/Europe/Nicosia. Category IDs match src/data.js. Prices integer cents, durations minutes in 5-minute increments (5–480). Bookings payment_method=`pay_at_salon`, payment_status=`unpaid` initially. Status=`confirmed|cancelled|completed|no_show`. Staff and service must belong to same salon. Central Postgres exclusion constraint rejects overlapping confirmed intervals for a staff member, including concurrent requests. Customer cannot supply prices, duration, customer_id, or payment status. Email comes from authenticated account. Confirmed email required to book. Cancellation policy default24 hours; owner can override cancellations. Availability limited to next90 days and at least1 hour notice. Maximum20 future confirmed bookings per customer. Slots at15-minute intervals within hours, excluding time off and confirmed bookings. Transactions protect creation/reschedule; idempotency key avoids duplicate retries. Salon registration creates draft, owner can submit pending, owner cannot self-publish. Admin publishes after review. RLS enforces salon ownership and customer booking isolation. No direct browser inserts/updates/deletes on bookings: use authorized RPCs.

RPCs (exact parameter names):

- `get_availability(p_service_id uuid,p_date date,p_staff_id uuid default null)` -> rows `{staff_id,staff_name,starts_at,ends_at,local_time}`. Published salons only, no customer information exposed. Anonymous allowed.
- `create_booking(p_service_id uuid,p_staff_id uuid,p_starts_at timestamptz,p_customer_name text,p_idempotency_key uuid)` -> booking row. Authenticated only.
- `cancel_booking(p_booking_id uuid)` -> booking row. Customer owns booking and before cutoff, or salon owner.
- `reschedule_booking(p_booking_id uuid,p_staff_id uuid,p_starts_at timestamptz)` -> booking row; transactional, original preserved on conflict.
- `create_salon(p_name text,p_city text,p_country text,p_category text,p_address text)` -> salon row, current user owner, draft.
- `submit_salon(p_salon_id uuid)` -> salon row. Require active service, staff and hours, status pending.
- `complete_booking(p_booking_id uuid,p_paid boolean)` -> booking row; salon owner only, mark completed/paid at salon after start.

- `replace_staff_hours(p_staff_id uuid,p_hours jsonb)` atomically replaces owner weekly hours.
- Service-role-only `enqueue_due_reminders()`, `notification_is_current(p_notification_id uuid)`, `claim_notifications(p_limit integer)`, `ack_notification(p_notification_id uuid,p_delivered boolean,p_error text)` manage private confirmation/change/cancellation/reminder mail. Reminders are queued around24 hours before a confirmed appointment; stale events are invalidated.

## Frontend API (`src/lib/platform.js`, root implements)

Exports `platformReady` boolean, `supabase` client or null, `listSalons()`, `listOwnSalons()`, `getSlots(serviceId,date,staffId=null)`, `createBooking({serviceId,staffId,startsAt,customerName,requestId})`, `listBookings()`, `cancelBooking(id)`, `rescheduleBooking({bookingId,staffId,startsAt})`, `updateProfile({name})`, `createSalon({name,city,country,category,address})`, `updateSalon(id,patch)`, `submitSalon(id)`, `saveStaff(salonId,staff)`, `saveService(salonId,service)`, `saveHours(staffId,hours)`, `saveTimeOff(staffId,entry)`, `deleteTimeOff(id)`, `listBusinessBookings(salonId,date)`, `completeBooking(id,paid)`.

All async throw normalized errors with Greek userMessage (use `error.userMessage || error.message`). `listSalons` returns public frontend shape matching current demo: `{id,name,category,city,country,location,address,timezone,description,photoIndex,imageUrl,isDemo:false,rating:null,reviewCount:0,cancellationHours,services:[{id,name,duration,price,active}],staff:[{id,name,active}],hours:[raw staff_hours],timeOff:[raw staff_time_off],status}`; owner list includes inactive staff/services and non-public salons. `getSlots` returns camelCase `{staffId,staffName,startsAt,endsAt,time}`. Booking methods return frontend `{id,salonId,salonName,service:{id,name,duration,price},staffId,staff,date:'YYYY-MM-DD',time,name,email,payment:'venue',status,paymentStatus,startsAt,endsAt,country,cancellationHours}`.

Business CRUD input: saveStaff `{id?,name,active}`; saveService `{id?,name,duration,price,active}`; saveHours takes array `{weekday,opens_at,closes_at}` for a staff ID; saveTimeOff `{starts_at,ends_at,reason}`. Edits validate on server as well as client.

## React integration

Root creates `src/Account.jsx` with `useAccount()` and `AccountPanel({onClose})`, provides `AccountProvider` around App. Context `{user,profile,loading,signOut,updateProfile}`; profile shape `{name,email}`. Panel implements signup/email-confirmation/login/recovery/signout/profile. Account UI real only when platformReady.

`Booking.jsx` default continues demo if !platformReady; live mode requires logged-in verified account to confirm, uses server staff/slots, waits for async onConfirm to succeed before showing success, handles conflicts and stale availability. Root passes `{salon,onClose,onConfirm,bookings,initialDate,onRequireAuth}`. Live onConfirm input `{serviceId,staffId,startsAt,customerName,requestId}` and parent returns server booking; demo callback unchanged.

Business.jsx preserves current demo fallback; when platformReady renders independent `LiveBusiness({onBack})`. Agent owns src/LiveBusiness.jsx + src/live-business.css and one import/early delegation in existing Business.jsx; no other modifications to Business.jsx. LiveBusiness imports platform functions + useAccount, AccountPanel; all operations authenticated, actual owned salon, no sample entries. Adds onboarding draft listing, staff/services/hours/time-off, daily booking calendar, cancellation, reschedule, mark payment received at venue, owner-entered offline appointments with real server persistence, contact details and edits. Manual and online intervals share the same exclusion-protected calendar.

Live marketplace and My bookings loaded from backend, demo local records never migrate silently into live mode. Root owns App, platform, Account, docs/deployment config. Agent owns Booking, booking.css. Database agent owns supabase migrations/functions/tests. Browser agent owns tests only after integration. Preserve current Greek layout and compact normal-flow search, Barber eighth, current category artwork.

## Owner-entered calendar appointments (migration 002)

`bookings` adds `booking_source` (`online` or `offline`), `customer_phone`, `notes`,
`created_by` and an internal idempotency request hash. Online records retain their
verified customer identity. Offline records have no linked customer account and
require a verified owner, active service and active staff from the owner's salon.
Only owner RPCs create/edit them; browser writes remain blocked. Manual duration,
price, contact and notes are validated on the server. Confirmed records block
`get_availability` immediately through the same database overlap constraint.
They do not enqueue automatic customer email. Historical/future manual entries
are limited to 366 days either side of today; duration is 5–480 minutes in steps of 5.

- `create_manual_booking(p_salon_id,p_service_id,p_staff_id,p_starts_at,p_customer_name,p_idempotency_key,p_customer_email=null,p_customer_phone=null,p_duration_minutes=null,p_price_cents=null,p_notes='')`
- `edit_manual_booking(p_booking_id,p_service_id,p_staff_id,p_starts_at,p_customer_name,p_customer_email=null,p_customer_phone=null,p_duration_minutes=null,p_price_cents=null,p_notes='')`

`src/lib/ownerCalendar.js` wraps these RPCs and normalizes errors. Manual retries
reuse a UUID, and conflicting edits leave the original record intact. Online
rescheduling preserves the original agreement. Customer identity checks use
null-safe comparisons so an unlinked offline record cannot be claimed by customers.

## Administration and monthly subscriptions (migration 003)

`/#admin` requires a confirmed account with trusted app metadata role `admin`.
The privileged SQL Editor assigns this role with `supabase/activate-admin.sql`.
Browser email comparisons and user metadata are never authorization sources.
The admin role is checked again inside SECURITY DEFINER functions with empty
search paths. Salons cannot approve themselves or change platform billing.

Protected tables: `platform_billing_settings`, `business_subscriptions`,
`business_charges`, `business_reviews`; service-only checkout reservations and
provider events are private. Owners can read their own billing, administrators
manage through authorized RPCs, and direct browser writes are blocked.

- `admin_overview(p_days=30)` returns actual counts, revenue records and daily statistics
- `admin_list_salons(p_status=null)`, `admin_get_salon(p_salon_id)` return review details
- `admin_review_salon(p_salon_id,p_decision,p_note='')` approves a complete listing or rejects it with a required note
- `get_platform_billing()`, `admin_set_platform_billing(p_monthly_price_cents,p_enabled)` manage the monthly euro offer
- `admin_set_business_subscription(p_salon_id,p_monthly_price_cents,p_status,p_provider='manual')`
- `admin_create_business_charge(p_salon_id,p_period_start,p_period_end,p_amount_cents=null,p_due_date=null)` uses an exclusive period-end date
- `admin_set_charge_status(p_charge_id,p_status,p_reference='')` records a manually received payment or voids a pending charge; it never charges a card
- `get_business_billing(p_salon_id)` returns the owner's plan, subscription and charge history

No fee is invented: the initial monthly amount is null and billing is disabled.
Stripe-controlled records cannot be marked paid manually. The checkout function
uses verified bearer identity, server-side ownership and price snapshots plus a
reservation to prevent duplicate subscriptions across tabs. Only signed webhook
events confirm card payments; event/invoice IDs are deduplicated and stale failures
cannot undo payment. Existing payment-portal management can stay available when
new subscription sales are disabled. Automatic card collection needs the operator's
Stripe account, private secrets, deployed functions and tested webhooks; source
code alone is not an activated payment service. See the function READMEs.
