/** Stripe-signed subscription events only. Never mark a charge paid from a browser redirect. */
type Json = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_VERSION = '2025-02-24.acacia';
const acceptedEvents = new Set([
  'checkout.session.completed', 'checkout.session.expired', 'invoice.paid', 'invoice.payment_failed',
  'customer.subscription.updated', 'customer.subscription.deleted',
]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

function equalHex(left: string, right: string) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index++) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

export async function verifySignature(raw: string, signature: string, secret: string, now = Date.now() / 1000) {
  if (!signature || signature.length > 4096) return false;
  const pairs = signature.split(',').map(part => part.trim().split('='));
  const timestamps = pairs.filter(pair => pair[0] === 't').map(pair => pair[1]);
  const signatures = pairs.filter(pair => pair[0] === 'v1').map(pair => pair[1]).filter(value => /^[0-9a-f]{64}$/.test(value || ''));
  if (timestamps.length !== 1 || !/^\d{10}$/.test(timestamps[0] || '') || !signatures.length) return false;
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamps[0]}.${raw}`)));
  const expected = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return signatures.some(signature => equalHex(signature, expected));
}

async function rawBody(request: Request) {
  const maximum = 1024 * 1024;
  if (Number(request.headers.get('content-length') || 0) > maximum) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}

const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const providerId = (value: unknown): string | null => {
  const id = typeof value === 'string' ? value : object(value).id;
  return typeof id === 'string' && /^[a-z]+_[A-Za-z0-9_]+$/.test(id) ? id : null;
};
const instant = (value: unknown): string | null => {
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp < 253402300799
    ? new Date(timestamp * 1000).toISOString() : null;
};
const metadataSalon = (...values: unknown[]) => {
  for (const value of values) {
    const id = object(value).salon_id;
    if (typeof id === 'string' && UUID.test(id)) return id;
  }
  return null;
};

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const signature = request.headers.get('Stripe-Signature') || '';
  if (!signature) return json({ error: 'INVALID_SIGNATURE' }, 400);
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !stripeKey || !supabaseUrl || !serviceKey) return json({ error: 'WEBHOOK_NOT_CONFIGURED' }, 503);
  let raw: string | null;
  try { raw = await rawBody(request); } catch { return json({ error: 'INVALID_PAYLOAD' }, 400); }
  if (raw === null) return json({ error: 'REQUEST_TOO_LARGE' }, 413);
  if (!await verifySignature(raw, signature, secret)) return json({ error: 'INVALID_SIGNATURE' }, 400);
  let event: Json;
  try { event = object(JSON.parse(raw)); } catch { return json({ error: 'INVALID_PAYLOAD' }, 400); }
  const eventId = providerId(event.id);
  const eventType = String(event.type || '');
  if (!eventId?.startsWith('evt_') || !eventType) return json({ error: 'INVALID_EVENT' }, 400);
  if (!acceptedEvents.has(eventType)) return json({ received: true, ignored: true });
  const data = object(object(event.data).object);
  const parent = object(data.parent);
  const subscriptionDetails = object(parent.subscription_details || data.subscription_details);
  const lines = object(data.lines).data;
  const invoiceLines = Array.isArray(lines) ? lines.map(object) : [];
  const recurringLine = invoiceLines.find(line => {
    const details = object(object(line.parent).subscription_item_details);
    const recurring = line.type === 'subscription' || object(line.parent).type === 'subscription_item_details' || providerId(line.subscription_item);
    const subscription = providerId(line.subscription || details.subscription);
    const invoiceSubscription = providerId(data.subscription || subscriptionDetails.subscription);
    return recurring && line.proration !== true && details.proration !== true
      && (!subscription || !invoiceSubscription || subscription === invoiceSubscription);
  });
  const linePeriod = object((recurringLine || invoiceLines[0] || {}).period);
  const payload: Json = {
    event_created_at: instant(event.created),
    salon_id: metadataSalon(data.metadata, subscriptionDetails.metadata),
    stripe_customer_id: providerId(data.customer),
    stripe_subscription_id: providerId(data.subscription || subscriptionDetails.subscription),
    stripe_checkout_id: null, stripe_invoice_id: null,
    status: 'pending', amount_cents: null,
    currency: typeof data.currency === 'string' ? data.currency.toUpperCase() : null,
    period_start: instant(data.current_period_start || data.period_start || linePeriod.start),
    period_end: instant(data.current_period_end || data.period_end || linePeriod.end),
    paid_at: null, payment_status: null,
  };
  if (eventType.startsWith('checkout.session.')) {
    if (data.mode !== 'subscription') return json({ received: true, ignored: true });
    payload.stripe_checkout_id = providerId(data.id);
    payload.payment_status = typeof data.payment_status === 'string' ? data.payment_status : null;
    payload.status = eventType === 'checkout.session.expired' ? 'cancelled' : data.payment_status === 'paid' ? 'active' : 'pending';
  } else if (eventType.startsWith('invoice.')) {
    payload.stripe_invoice_id = providerId(data.id);
    // Invoice-level periods describe when invoice items accumulated; the first
    // invoice can have equal start/end values. The recurring line describes the
    // purchased subscription period and retains its exclusive ending instant.
    payload.period_start = instant(linePeriod.start) || instant(data.period_start);
    payload.period_end = instant(linePeriod.end) || instant(data.period_end);
    payload.status = eventType === 'invoice.paid' ? 'active' : 'past_due';
    const amount = Number(eventType === 'invoice.paid' ? data.amount_paid : data.amount_due);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000) return json({ error: 'INVALID_INVOICE_AMOUNT' }, 400);
    payload.amount_cents = amount;
    if (eventType === 'invoice.paid') payload.paid_at = instant(object(data.status_transitions).paid_at || event.created);
    // Stripe does not guarantee event ordering. Finding the already-created
    // checkout session lets SQL link a first invoice even before completion's
    // webhook arrives. Only provider data is used, after signature verification.
    if (payload.stripe_subscription_id) {
      try {
        const query = new URLSearchParams({ subscription: String(payload.stripe_subscription_id), limit: '1' });
        const lookup = await fetch(`https://api.stripe.com/v1/checkout/sessions?${query}`, {
          headers: { Authorization: `Bearer ${stripeKey}`, 'Stripe-Version': STRIPE_VERSION }, signal: AbortSignal.timeout(12_000),
        });
        if (!lookup.ok) { await lookup.body?.cancel(); return json({ error: 'PROVIDER_LOOKUP_UNAVAILABLE' }, 502); }
        const result = await lookup.json();
        const session = object(Array.isArray(result.data) ? result.data[0] : null);
        const sessionSubscription = providerId(session.subscription);
        if (session.mode === 'subscription' && sessionSubscription === payload.stripe_subscription_id) {
          payload.stripe_checkout_id = providerId(session.id);
          const salon = metadataSalon(session.metadata);
          if (salon && payload.salon_id && salon !== payload.salon_id) return json({ error: 'EVENT_BUSINESS_MISMATCH' }, 400);
          payload.salon_id ||= salon;
          payload.stripe_customer_id ||= providerId(session.customer);
        }
      } catch { return json({ error: 'PROVIDER_LOOKUP_UNAVAILABLE' }, 502); }
    }
  } else {
    payload.stripe_subscription_id = providerId(data.id);
    if (typeof data.cancel_at_period_end === 'boolean') payload.cancel_at_period_end = data.cancel_at_period_end;
    const status = String(data.status || '');
    payload.status = eventType.endsWith('.deleted') || ['canceled', 'unpaid', 'incomplete_expired'].includes(status)
      ? 'cancelled' : ['active', 'trialing'].includes(status) ? 'active'
      : ['past_due', 'paused'].includes(status) ? 'past_due' : 'pending';
    // Newer Stripe versions put period timestamps on the subscription item.
    const items = object(data.items).data;
    const item = object(Array.isArray(items) ? items[0] : null);
    payload.period_start ||= instant(item.current_period_start);
    payload.period_end ||= instant(item.current_period_end);
  }

  try {
    const result = await fetch(`${supabaseUrl}/rest/v1/rpc/apply_stripe_billing_event`, {
      method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event_id: eventId, p_event_type: eventType, p_payload: payload }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!result.ok) { await result.body?.cancel(); return json({ error: 'BILLING_EVENT_NOT_RECORDED' }, 502); }
    const body = await result.json();
    // Return safe acknowledgment metadata only; never customer/contact details.
    return json({ received: true, processed: Boolean(body?.processed), duplicate: Boolean(body?.duplicate), ignored: Boolean(body?.ignored) });
  } catch { return json({ error: 'BILLING_EVENT_NOT_RECORDED' }, 502); }
}

if (import.meta.main) Deno.serve(handleRequest);
