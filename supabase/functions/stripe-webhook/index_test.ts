import { handleRequest, verifySignature } from './index.ts';

const SALON = '00000000-0000-4000-8000-000000000001';
const secret = 'test-webhook-secret-not-a-real-credential';
const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
function setup() {
  const previous = new Map(names.map(name => [name, Deno.env.get(name)]));
  Deno.env.set('SUPABASE_URL', 'https://database.example.test');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-server-only');
  Deno.env.set('STRIPE_SECRET_KEY', 'test-stripe-server-only');
  Deno.env.set('STRIPE_WEBHOOK_SECRET', secret);
  return () => { for (const [name, value] of previous) { if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value); } };
}
async function signature(raw: string, timestamp = Math.floor(Date.now() / 1000)) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${raw}`)));
  return `t=${timestamp},v1=${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
async function request(event: unknown, overrides: { signature?: string; timestamp?: number; raw?: string } = {}) {
  const raw = overrides.raw || JSON.stringify(event);
  return new Request('https://edge.example.test/stripe-webhook', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': overrides.signature ?? await signature(raw, overrides.timestamp) }, body: raw });
}
const paidInvoice = () => ({
  id: 'evt_invoice_paid', type: 'invoice.paid', created: Math.floor(Date.now() / 1000),
  data: { object: { id: 'in_paid', customer: 'cus_customer', subscription: 'sub_monthly',
    currency: 'eur', amount_paid: 2900, amount_due: 2900,
    period_start: 1790812800, period_end: 1790812800,
    subscription_details: { metadata: { salon_id: SALON } },
    lines: { data: [{ period: { start: 1790812800, end: 1793491200 } }] },
    status_transitions: { paid_at: 1790812800 }, } },
});

Deno.test('webhook verifies original bytes, timestamp and secret before any network call', async () => {
  const restore = setup(); const previousFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error('No external request permitted'); }) as typeof fetch;
  try {
    assert((await handleRequest(new Request('https://edge.example.test'))).status === 405, 'GET cannot process events');
    const invalid = await request(paidInvoice(), { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` });
    assert((await handleRequest(invalid)).status === 400, 'Forged HMAC must fail');
    assert((await handleRequest(await request(paidInvoice(), { timestamp: Math.floor(Date.now() / 1000) - 301 }))).status === 400, 'Expired replay must fail');
    const raw = JSON.stringify(paidInvoice()); const correct = await signature(raw);
    assert(!await verifySignature(raw + ' ', correct, secret), 'JSON-equivalent bytes cannot use a different signature');
    assert((await handleRequest(await request({}, { raw: '{invalid-json' }))).status === 400, 'Signed malformed payload cannot reach DB');
    assert(calls === 0, 'All rejected requests must be side-effect free');
    Deno.env.delete('STRIPE_WEBHOOK_SECRET');
    assert((await handleRequest(await request(paidInvoice()))).status === 503, 'Missing configuration must fail closed');
    assert(calls === 0, 'Missing configuration cannot touch queue or provider');
  } finally { globalThis.fetch = previousFetch; restore(); }
});

Deno.test('signed unsupported events are acknowledged without applying any billing state', async () => {
  const restore = setup(); const previousFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('Unsupported event must not call network'); }) as typeof fetch;
  try {
    const response = await handleRequest(await request({ id: 'evt_other', type: 'payment_intent.created', created: Math.floor(Date.now() / 1000), data: { object: {} } }));
    assert(response.status === 200 && (await response.json()).ignored === true, 'Unrelated merchant events are ignored');
  } finally { globalThis.fetch = previousFetch; restore(); }
});

Deno.test('first paid invoice is linked from Stripe session before completion, with idempotent event acknowledgment', async () => {
  const restore = setup(); const previousFetch = globalThis.fetch;
  const events = new Set<string>(); const applied: Record<string, unknown>[] = []; let chargedRows = 0; let lookups = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions?')) {
      lookups++;
      const query = new URL(url).searchParams;
      assert(query.get('subscription') === 'sub_monthly', 'Lookup is scoped to signed subscription');
      return Response.json({ data: [{ id: 'cs_known', mode: 'subscription', subscription: 'sub_monthly', customer: 'cus_customer', metadata: { salon_id: SALON } }] });
    }
    if (url.endsWith('/apply_stripe_billing_event')) {
      const body = JSON.parse(String(init?.body)); applied.push(body);
      const duplicate = events.has(body.p_event_id); events.add(body.p_event_id);
      if (!duplicate) chargedRows++;
      return Response.json({ processed: !duplicate, duplicate, salon_id: SALON, status: 'active' });
    }
    throw new Error('Unexpected endpoint');
  }) as typeof fetch;
  try {
    const first = await handleRequest(await request(paidInvoice()));
    const second = await handleRequest(await request(paidInvoice()));
    const firstBody = await first.json(), secondBody = await second.json();
    assert(first.status === 200 && firstBody.processed === true, 'Valid event acknowledged after durable processing');
    assert(second.status === 200 && secondBody.duplicate === true && chargedRows === 1, 'Replay is idempotent in DB ledger');
    const payload = applied[0].p_payload as Record<string, unknown>;
    assert(payload.stripe_checkout_id === 'cs_known' && payload.stripe_subscription_id === 'sub_monthly', 'Invoice-before-checkout ordering is mapped through known session');
    assert(payload.amount_cents === 2900 && payload.currency === 'EUR' && payload.status === 'active', 'Trusted provider amount/currency are normalized');
    assert(payload.period_start === '2026-10-01T00:00:00.000Z', 'Epoch timestamps become unambiguous ISO instants');
    assert(lookups === 2, 'Replay may reread provider state but cannot duplicate ledger effects');
    assert(!JSON.stringify(firstBody).includes('server-only') && !JSON.stringify(firstBody).includes('@'), 'Acknowledgment contains no credentials or contact details');
  } finally { globalThis.fetch = previousFetch; restore(); }
});

Deno.test('provider session/business mismatch cannot mark another salon invoice paid', async () => {
  const restore = setup(); const previousFetch = globalThis.fetch; let applyCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).startsWith('https://api.stripe.com/')) return Response.json({ data: [{ id: 'cs_other', mode: 'subscription', subscription: 'sub_monthly', metadata: { salon_id: '00000000-0000-4000-8000-000000000009' } }] });
    applyCalls++; return Response.json({ processed: true });
  }) as typeof fetch;
  try {
    const response = await handleRequest(await request(paidInvoice()));
    assert(response.status === 400 && applyCalls === 0, 'Business mismatches fail before applying event');
  } finally { globalThis.fetch = previousFetch; restore(); }
});

Deno.test('invoice uses matching recurring line period before one-off or proration lines', async () => {
  const restore = setup(); const previousFetch = globalThis.fetch;
  const payloads: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('https://api.stripe.com/')) return Response.json({ data: [] });
    payloads.push(JSON.parse(String(init?.body)).p_payload);
    return Response.json({ processed: true });
  }) as typeof fetch;
  try {
    const event = paidInvoice();
    const recurringPeriod = { start: 1790812800, end: 1793491200 };
    const invoiceLines = [
      { type: 'invoiceitem', period: { start: 1790812800, end: 1790812800 } },
      { type: 'subscription', subscription: 'sub_other', period: { start: 1790899200, end: 1790985600 } },
      { type: 'subscription', subscription: 'sub_monthly', proration: true, period: { start: 1790899200, end: 1793491200 } },
      { parent: { type: 'subscription_item_details', subscription_item_details: { subscription: 'sub_monthly', proration: false } }, period: recurringPeriod },
    ];
    event.data.object.lines.data = invoiceLines;
    for (const type of ['invoice.paid', 'invoice.payment_failed']) {
      event.type = type;
      assert((await handleRequest(await request(event))).status === 200, 'Both invoice outcomes can record their actual subscription period');
    }
    assert(payloads.length === 2 && payloads.every(payload => payload.period_start === '2026-10-01T00:00:00.000Z'
      && payload.period_end === '2026-11-01T00:00:00.000Z'), 'The matching recurring month retains its exclusive end despite zero-length invoice totals or unrelated lines');
  } finally { globalThis.fetch = previousFetch; restore(); }
});

Deno.test('database failure is not acknowledged, so Stripe can retry safely', async () => {
  const restore = setup(); const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).startsWith('https://api.stripe.com/')) return Response.json({ data: [] });
    return Response.json({ message: 'private database diagnostic' }, { status: 503 });
  }) as typeof fetch;
  try {
    const response = await handleRequest(await request(paidInvoice()));
    const body = await response.json();
    assert(response.status === 502 && body.error === 'BILLING_EVENT_NOT_RECORDED', 'Failure must remain retryable');
    assert(!JSON.stringify(body).includes('private database'), 'Private diagnostics do not escape');
  } finally { globalThis.fetch = previousFetch; restore(); }
});

Deno.test('subscription failure/deletion events normalize status without fabricating paid charges', async () => {
  const restore = setup(); const previousFetch = globalThis.fetch; const payloads: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)).p_payload); return Response.json({ processed: true, duplicate: false });
  }) as typeof fetch;
  try {
    const event = { id: 'evt_subscription', type: 'customer.subscription.deleted', created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_monthly', customer: 'cus_customer', status: 'canceled', metadata: { salon_id: SALON }, current_period_start: 1790812800, current_period_end: 1793491200 } } };
    assert((await handleRequest(await request(event))).status === 200, 'Cancellation event accepted');
    assert(payloads[0].status === 'cancelled' && payloads[0].paid_at === null && payloads[0].amount_cents === null, 'Cancellation must not create payment');
    assert(payloads[0].stripe_subscription_id === 'sub_monthly', 'Status update maps stored subscription');
  } finally { globalThis.fetch = previousFetch; restore(); }
});

Deno.test('expired checkout cancels only its pending provider session and never records payment', async () => {
  const restore = setup(); const previousFetch = globalThis.fetch; let applied: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    applied = JSON.parse(String(init?.body)); return Response.json({ processed: true });
  }) as typeof fetch;
  try {
    const event = { id: 'evt_expired', type: 'checkout.session.expired', created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cs_expired', mode: 'subscription', payment_status: 'unpaid', metadata: { salon_id: SALON } } } };
    assert((await handleRequest(await request(event))).status === 200, 'Expiry event is acknowledged after DB update');
    const payload = applied!.p_payload as Record<string, unknown>;
    assert(payload.status === 'cancelled' && payload.stripe_checkout_id === 'cs_expired', 'Only the known pending session is expired');
    assert(payload.paid_at === null && payload.amount_cents === null, 'Expiry cannot fabricate paid revenue');
  } finally { globalThis.fetch = previousFetch; restore(); }
});
