# Monthly business subscription checkout

This is a server-only integration for businesses paying Eneres monthly. Customer
salon appointments continue to use payment at the salon. No card fields are
collected in the application, and the implementation does not charge a business
until its owner explicitly completes the Stripe-hosted subscription checkout.

## Activation

1. Apply `202610240003_admin_billing.sql` after the earlier booking migrations.
   The platform administrator sets the monthly euro price in the admin dashboard.
   No example price or payment account is created by these functions.
2. Complete the operator-owned Stripe account setup and first use Stripe test mode.
3. In **Supabase Edge Function secrets**, enter `STRIPE_SECRET_KEY` and `SITE_URL`.
   The current site URL is `https://loukiamic-maker.github.io/LM-app/`. After an owned
   custom domain is activated, update it to that domain's HTTPS root. Keep private
   keys in the provider's secret settings, never in chat, frontend files or `VITE_*`.
   Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` inside the function runtime.
4. Deploy both functions using the owner's authenticated Supabase CLI:

   ```sh
   supabase functions deploy create-subscription-checkout
   supabase functions deploy stripe-webhook
   ```

   Both function sections need `verify_jwt = false` in `supabase/config.toml`.
   Checkout itself verifies the bearer session with Supabase Auth `getUser` and
   the service-only database function rechecks the verified account and salon
   ownership. The webhook uses Stripe's raw-body HMAC signature instead of a
   Supabase session.
5. Configure the Stripe endpoint and `STRIPE_WEBHOOK_SECRET` exactly as described
   in the adjacent `stripe-webhook/README.md`. Enable Stripe Customer Portal if
   businesses should manage their payment method or cancel through that portal.
6. Once the secrets, webhook and deployed functions are ready, use the project's
   privileged SQL Editor to enable the provider integration:

   ```sql
   select public.billing_enable_stripe(true);
   ```

   This does not activate a salon or charge a card. The admin dashboard separately
   controls whether a positive monthly subscription price is offered.
7. Test a real owner session in Stripe **test mode**, the first signed paid invoice,
   webhook retries, cancellation and failed renewal. Move to live credentials only
   after these checks pass. These repository tests use mocked HTTP calls and are
   not evidence of a live Stripe payment or account activation.

## Browser contract

POST with the owner's Supabase bearer session:

```json
{"salon_id":"actual-salon-uuid","request_id":"stable-request-uuid","action":"subscribe"}
```

- `subscribe` returns `{ "url": "https://checkout.stripe.com/...", "mode": "subscription" }`.
- `manage` uses the stored Stripe customer and returns a Stripe Billing Portal URL.
- `status` needs only `salon_id` and `action`. It returns
  `{ "configured": boolean, "manage_configured": boolean }` after account/ownership
  verification, without making any Stripe request. Existing Stripe customers can
  still manage or cancel through the portal when new subscriptions are disabled.

The browser cannot choose a price, billing customer, currency or return address.
Checkout returns only approved Stripe-hosted URLs. A database lease prevents two
tabs creating distinct payable sessions for the same salon concurrently, while
the request UUID preserves the same provider idempotency key across retries.
The database reservation owns the price snapshot; keep the same request UUID
after an uncertain network failure. A session is returned only after its mapping
has been stored. Repeated clicks reuse a still-open session, and existing active
subscriptions cannot create duplicate subscriptions.

A successful browser return is **not proof of payment**. Only verified provider
events update paid records. Missing settings return an explicit error rather than
pretending a payment succeeded. Provider failures can be retried with the same
request UUID; no secrets or provider response bodies are copied into public errors.

## Local validation

```sh
deno test --allow-env \
  supabase/functions/create-subscription-checkout/index_test.ts \
  supabase/functions/stripe-webhook/index_test.ts
```

All network access is mocked. No database, Stripe session, card charge, account or
email is created by this test command.
