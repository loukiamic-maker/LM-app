# Verified subscription payment events

Register this HTTPS endpoint in the operator's Stripe account:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

Subscribe to:

- `checkout.session.completed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Use the corresponding endpoint's signing secret as the server-only Supabase
`STRIPE_WEBHOOK_SECRET`. Test and live endpoints have different signing secrets.
The function also requires the matching `STRIPE_SECRET_KEY` for read-only lookup
of the original checkout session when Stripe delivers the first invoice before
the checkout completion event. Supabase supplies its own URL and service-role
runtime credentials. Never publish these values or paste them into chat.

The function verifies the original request bytes against the `Stripe-Signature`
HMAC SHA-256 with a five-minute timestamp tolerance, then maps only known checkout
sessions or subscriptions through the service-only `apply_stripe_billing_event`
RPC. A browser-supplied business UUID, return URL or payment-success query cannot
mark a charge paid. Signed events for unrelated subscriptions do not create new
businesses. Mismatched session metadata is rejected.

The database deduplicates provider event IDs and invoice IDs, preserves paid
records against stale failures, and uses provider creation times for subscription
status ordering. Signed invoice amounts are recorded as integer euro cents.
Subscription status events do not fabricate paid charge records. If the provider
lookup or database write is unavailable, the handler responds with an error so
Stripe can retry rather than falsely acknowledging payment.

This integration does not deploy itself, configure a merchant account or enable
live charges automatically. Follow the checkout activation guide and verify a
Stripe test subscription, paid invoice, replay and cancellation first. Actual
accounting, tax settings and receipts remain configured in the operator's Stripe
account and business processes.
