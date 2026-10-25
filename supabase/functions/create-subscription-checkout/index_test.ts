import { handleRequest } from './index.ts';

const SALON = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const REQUEST = '00000000-0000-4000-8000-000000000003';
const site = 'https://website.example.test/LM-app/';
const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'SITE_URL'];
const baseContext = {
  salon_id: SALON, salon_name: 'Πραγματικό κατάστημα', owner_id: USER,
  owner_email: 'owner@example.test', user_email: 'owner@example.test',
  amount_cents: 2900, currency: 'EUR', enabled: true, online_checkout_available: true,
  stripe_customer_id: null, stripe_subscription_id: null, subscription_status: 'pending',
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
function setup() {
  const previous = new Map(names.map(name => [name, Deno.env.get(name)]));
  Deno.env.set('SUPABASE_URL', 'https://database.example.test');
  Deno.env.set('SUPABASE_ANON_KEY', 'test-public-only');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-server-only');
  Deno.env.set('STRIPE_SECRET_KEY', 'test-stripe-server-only');
  Deno.env.set('SITE_URL', site);
  return () => { for (const [name, value] of previous) { if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value); } };
}
function request(body: Record<string, unknown> = {}, authenticated = true, origin = 'https://website.example.test') {
  return new Request('https://edge.example.test/create-subscription-checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin,
      ...(authenticated ? { Authorization: 'Bearer signed-user-session' } : {}), },
    body: JSON.stringify({ salon_id: SALON, request_id: REQUEST, ...body }),
  });
}
type Call = { url: string; method?: string; headers: Headers; body: string };
function mock(options: { context?: Record<string, unknown>; reservedContext?: Record<string, unknown>; reserveBusy?: boolean; confirmed?: boolean; forbidden?: boolean; checkoutUrl?: string } = {}) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const body = String(init?.body || '');
    calls.push({ url, method: init?.method, headers: new Headers(init?.headers), body });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: USER, email_confirmed_at: options.confirmed === false ? null : '2026-01-01T00:00:00Z' });
    if (url.endsWith('/billing_checkout_context')) return options.forbidden
      ? Response.json({ message: 'SALON_OWNER_REQUIRED' }, { status: 403 })
      : Response.json({ ...baseContext, ...options.context });
    if (url.endsWith('/billing_reserve_checkout')) return options.reserveBusy
      ? Response.json({ message: 'BILLING_CHECKOUT_IN_PROGRESS' }, { status: 409 })
      : Response.json({ ...baseContext, ...options.context, ...options.reservedContext });
    if (url.endsWith('/billing_record_checkout')) return Response.json({ status: 'pending' });
    if (url === 'https://api.stripe.com/v1/checkout/sessions') return Response.json({
      id: 'cs_test_session', url: options.checkoutUrl || 'https://checkout.stripe.com/c/pay/cs_test_session',
      customer: 'cus_test_customer', subscription: null,
    });
    if (url === 'https://api.stripe.com/v1/checkout/sessions/cs_existing') return Response.json({
      id: 'cs_existing', status: 'open', expires_at: Math.floor(Date.now() / 1000) + 3600,
      url: 'https://checkout.stripe.com/c/pay/cs_existing',
    });
    if (url === 'https://api.stripe.com/v1/billing_portal/sessions') return Response.json({ url: 'https://billing.stripe.com/p/session/test_session' });
    throw new Error('Unexpected mocked endpoint');
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test('checkout rejects unauthorized, unconfirmed and cross-origin calls without Stripe', async () => {
  const restore = setup(); const network = mock({ confirmed: false });
  try {
    assert((await handleRequest(request({}, false))).status === 401, 'Anonymous caller must fail');
    assert((await handleRequest(request({}, true, 'https://attacker.example.test'))).status === 403, 'Wrong origin must fail');
    assert((await handleRequest(request())).status === 403, 'Unconfirmed account must fail');
    assert(network.calls.length === 1 && network.calls[0].url.endsWith('/auth/v1/user'), 'Only confirmed auth validation can touch the network');
  } finally { network.restore(); restore(); }
});

Deno.test('status authenticates and checks ownership but never creates a provider session', async () => {
  const restore = setup(); const network = mock();
  try {
    const response = await handleRequest(request({ action: 'status', request_id: undefined }));
    const body = await response.json();
    assert(response.status === 200 && body.configured === true, 'Ready setup must be reported');
    assert(network.calls.length === 2 && network.calls.every(call => !call.url.includes('stripe.com')), 'Status has no Stripe effects');
    Deno.env.delete('STRIPE_SECRET_KEY');
    const missing = await handleRequest(request({ action: 'status', request_id: undefined }));
    assert(missing.status === 200 && (await missing.json()).configured === false, 'Missing secret must report unconfigured');
    assert(network.calls.every(call => !call.url.includes('stripe.com')), 'Unconfigured probe still has no provider call');
  } finally { network.restore(); restore(); }
});

Deno.test('a different salon owner cannot create checkout or inspect configuration', async () => {
  const restore = setup(); const network = mock({ forbidden: true });
  try {
    assert((await handleRequest(request())).status === 403, 'Ownership mismatch must fail');
    assert((await handleRequest(request({ action: 'status', request_id: undefined }))).status === 403, 'Status must enforce ownership too');
    assert(!network.calls.some(call => call.url.includes('stripe.com')), 'Forbidden caller cannot touch Stripe');
  } finally { network.restore(); restore(); }
});

Deno.test('monthly checkout uses server price, fixed return origin and stable retry keys', async () => {
  const restore = setup(); const network = mock();
  try {
    const forged = { amount_cents: 1, currency: 'usd', success_url: 'https://attacker.example.test', action: 'subscribe' };
    const first = await handleRequest(request(forged));
    const second = await handleRequest(request(forged));
    assert(first.status === 200 && second.status === 200, 'Idempotent retries may return the same hosted session');
    const firstBody = await first.json(), secondBody = await second.json();
    assert(firstBody.url === secondBody.url && firstBody.url.startsWith('https://checkout.stripe.com/'), 'Only the provider URL is returned');
    const calls = network.calls.filter(call => call.url === 'https://api.stripe.com/v1/checkout/sessions');
    const params = new URLSearchParams(calls[0].body);
    assert(params.get('mode') === 'subscription', 'Must create a subscription, not a consumer salon charge');
    assert(params.get('line_items[0][price_data][unit_amount]') === '2900', 'Price must come from the server plan');
    assert(params.get('line_items[0][price_data][currency]') === 'eur', 'Currency cannot be forged');
    assert(params.get('line_items[0][price_data][recurring][interval]') === 'month', 'Interval is fixed to monthly');
    assert(params.get('success_url')?.startsWith(`${site}?billing=success`) && params.get('success_url')?.endsWith('#business'), 'Callback is the configured website');
    assert(!params.toString().includes('attacker'), 'Client redirects are discarded');
    assert(calls[0].headers.get('Idempotency-Key') === calls[1].headers.get('Idempotency-Key'), 'Retry key must remain stable');
    const recorded = network.calls.filter(call => call.url.endsWith('/billing_record_checkout'));
    assert(recorded.length === 2 && JSON.parse(recorded[0].body).p_request_id === REQUEST, 'Session mapping is durably recorded by server RPC');
    assert(!JSON.stringify(firstBody).includes('server-only'), 'Provider and database secrets never enter response');
  } finally { network.restore(); restore(); }
});

Deno.test('missing provider configuration and active subscriptions cannot create new charges', async () => {
  const restore = setup(); let network = mock();
  try {
    Deno.env.delete('STRIPE_SECRET_KEY');
    assert((await handleRequest(request())).status === 503, 'Missing provider must fail closed');
    assert(!network.calls.some(call => call.url.includes('stripe.com')), 'Unconfigured checkout cannot call Stripe');
    network.restore(); Deno.env.set('STRIPE_SECRET_KEY', 'test-stripe-server-only');
    network = mock({ context: { stripe_subscription_id: 'sub_existing', subscription_status: 'active' } });
    assert((await handleRequest(request())).status === 409, 'Existing active subscription must not be duplicated');
    assert(!network.calls.some(call => call.url.includes('stripe.com')), 'Duplicate subscription blocked before provider call');
  } finally { network.restore(); restore(); }
});

Deno.test('billing portal uses stored customer even when new sales are disabled and permits only Stripe-hosted redirects', async () => {
  const restore = setup(); let network = mock({ context: { stripe_customer_id: 'cus_existing', enabled: false, online_checkout_available: false, amount_cents: null } });
  try {
    const status = await (await handleRequest(request({ action: 'status', request_id: undefined }))).json();
    assert(status.configured === false && status.manage_configured === true, 'Disabling new sales must not block existing customer management');
    const response = await handleRequest(request({ action: 'manage', customer: 'cus_forged' }));
    assert(response.status === 200 && (await response.json()).mode === 'portal', 'Known customer can manage through provider');
    const call = network.calls.find(call => call.url.includes('billing_portal'))!;
    assert(new URLSearchParams(call.body).get('customer') === 'cus_existing', 'Browser cannot select another billing customer');
    network.restore(); network = mock({ checkoutUrl: 'https://attacker.example.test/checkout' });
    assert((await handleRequest(request())).status === 502, 'Untrusted hosted checkout URL must not be returned');
  } finally { network.restore(); restore(); }
});

Deno.test('database reservation precedes provider creation and owns the retry price snapshot', async () => {
  const restore = setup(); let network = mock({ reservedContext: { amount_cents: 3900 } });
  try {
    assert((await handleRequest(request())).status === 200, 'Reserved plan can create checkout');
    const reservation = network.calls.findIndex(call => call.url.endsWith('/billing_reserve_checkout'));
    const provider = network.calls.findIndex(call => call.url === 'https://api.stripe.com/v1/checkout/sessions');
    assert(reservation >= 0 && reservation < provider, 'Parallel checkout lease must be acquired before provider effects');
    assert(new URLSearchParams(network.calls[provider].body).get('line_items[0][price_data][unit_amount]') === '3900', 'Lease snapshot wins over stale context');
    network.restore(); network = mock({ reserveBusy: true });
    assert((await handleRequest(request())).status === 409, 'Other in-flight request must be rejected');
    assert(!network.calls.some(call => call.url.includes('stripe.com')), 'A losing tab cannot create another payable session');
  } finally { network.restore(); restore(); }
});

Deno.test('an existing pending checkout is reused without creating or remapping another payable session', async () => {
  const restore = setup(); const network = mock({ reservedContext: { reuse_checkout: true, stripe_checkout_id: 'cs_existing' } });
  try {
    const response = await handleRequest(request());
    assert(response.status === 200 && (await response.json()).session_id === 'cs_existing', 'Owner resumes the stored open session');
    assert(!network.calls.some(call => call.url === 'https://api.stripe.com/v1/checkout/sessions'), 'No new Stripe session may be created');
    assert(!network.calls.some(call => call.url.endsWith('/billing_record_checkout')), 'Reuse does not mutate payment mapping');
  } finally { network.restore(); restore(); }
});
