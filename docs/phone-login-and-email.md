# Eneres phone login and appointment emails

The website changes are ready. Real SMS and emails need the private services below; the public Supabase key cannot configure or pay for them. Installing the SQL update preserves existing accounts and appointments and leaves phone login switched off until setup is complete.

## 1. Connect SMS in Supabase

Use Twilio as the SMS provider. Create your own Twilio account, enable SMS delivery to Greece (+30) and Cyprus (+357), and obtain a messaging service suitable for those countries. Trial accounts generally restrict recipients; public customers need a production account with credit.

In your Supabase project, open **Authentication → Sign In / Providers → Phone** (or **Providers → Phone**), enable the phone provider and enter the Twilio credentials there. Keep phone confirmation enabled. Use a six-digit SMS code, a short expiry and rate limits. Enter private credentials only in these settings, never in chat or the website configuration.

Suggested Greek SMS template: `Ο κωδικός επιβεβαίωσης Eneres είναι {{ .Code }}. Μην τον κοινοποιείτε`.

## 2. Connect account email

Use Resend with a sending domain you own and verify the DNS records Resend gives you. `eneresbeauty.com` can be used only after you have registered it. A Gmail address cannot serve as a domain you control for Resend verification.

In Supabase **Authentication → Email → SMTP Settings**, enter the SMTP settings supplied by Resend. Keep **Confirm email** enabled. Under **Authentication → URL Configuration**, use this value for both the Site URL and allowed redirect URL:

`https://loukiamic-maker.github.io/LM-app/`

SMS confirms possession of the mobile; the email link confirms access to the email address. Both are required for a new online booking after activation. Existing users can sign in with email once, open their profile and verify their saved mobile with SMS. A newly registered phone account adds and confirms its email before booking.

## 3. Apply the database update

Copy the latest `eneres-account-booking-requirements.sql` into the privileged Supabase SQL Editor and run it. It includes migrations 006–008, can be rerun and does not reset data. Save the query as **Eneres — Account, booking & phone verification setup**.

The result **PROVIDER SETUP REQUIRED** for phone login is expected before activation. Installation checks are not evidence that a message has been delivered.

## 4. Enable appointment emails

Account verification emails and appointment emails are separate. Appointment events already enter a private queue when a booking is confirmed or cancelled by the business, including its cancellation note.

In Supabase **Edge Functions**, deploy `process-notifications` from `supabase/functions/process-notifications/index.ts`. The file is self-contained and can be pasted into the dashboard function editor. Its gateway setting **Verify JWT** must be off because the handler validates its own private bearer secret on every request. The repository's `supabase/config.toml` sets this for CLI deployments.

In **Edge Function Secrets**, add:

| Name | Value you supply privately |
| --- | --- |
| `RESEND_API_KEY` | Your Resend API key |
| `NOTIFICATION_FROM` | `Eneres <appointments@YOUR-VERIFIED-DOMAIN>` |
| `NOTIFICATION_WORKER_SECRET` | A randomly generated secret of at least 32 characters |

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. Do not add these as public website variables.

Open Supabase **Vault** and save the same worker secret under the name `eneres_notification_worker_secret`. Then run `supabase/operations/schedule-notification-worker.sql`. This starts processing appointment messages every minute. The scheduled request uses the Vault value without embedding the secret in the saved SQL.

The worker sends separate emails to the customer and business, retries temporary delivery failures and prevents duplicate sends during ordinary retries. A successful booking stays saved if an email provider is temporarily unavailable. Inspect queued older messages before starting delivery if you have already used the project for real appointments.

## 5. Activate and check your own account

After SMS, SMTP and the email worker are configured, run `supabase/operations/activate-phone-auth.sql`, then reload the website. Phone login will appear automatically. Use your own mobile and email to confirm that you receive the SMS code and email confirmation link.

Make one appointment with a consenting test business using your own customer email, then have the business cancel it with a note. Confirm you receive both appointment emails and the cancellation reason. These checks send real messages and may use provider credit. Invite customers only after these delivery checks succeed.

If delivery setup is incomplete, run the rollback statement at the end of the activation file to return to the existing email login. It does not delete accounts or bookings. Keep the main activation statement and rollback statement separate when running the file.
