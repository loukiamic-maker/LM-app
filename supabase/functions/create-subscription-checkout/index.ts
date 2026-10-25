/** Server-only monthly business subscriptions. Consumer bookings remain pay-at-salon. */
type Json = Record<string, unknown>;
type BillingContext = {
  salon_id: string; salon_name: string; owner_id: string; owner_email: string;
  user_email?: string; amount_cents: number | null; currency: string; enabled: boolean;
  online_checkout_available: boolean; stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null; subscription_status?: string | null;
  checkout_url?: string | null; stripe_checkout_id?: string | null;
  reuse_checkout?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_ID = /^[a-z]+_[A-Za-z0-9_]+$/;
const STRIPE_VERSION = '2025-02-24.acacia';
class BillingError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}

function configuredSite(): URL | null {
  try {
    const raw = Deno.env.get('SITE_URL');
    if (!raw) return null;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch { return null; }
}

function response(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin || '*', 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } });
}

const safeDatabaseError = (message: unknown) => {
  const code = String(message || '');
  if (/^(SALON_OWNER_REQUIRED|BILLING_FORBIDDEN|BILLING_ACCESS_DENIED|ADMIN_REQUIRED)$/.test(code)) return new BillingError('FORBIDDEN', 403);
  if (code === 'EMAIL_CONFIRMATION_REQUIRED') return new BillingError(code, 403);
  if (/^(BILLING_NOT_CONFIGURED|BILLING_NOT_ENABLED|STRIPE_NOT_CONFIGURED|BILLING_PRICE_REQUIRED)$/.test(code)) return new BillingError('BILLING_NOT_CONFIGURED', 503);
  if (code === 'BILLING_ALREADY_ACTIVE') return new BillingError(code, 409);
  if (code === 'BILLING_CHECKOUT_IN_PROGRESS') return new BillingError(code, 409);
  if (code === 'BILLING_PERIOD_ALREADY_PAID') return new BillingError(code, 409);
  if (/^(SALON_NOT_FOUND|BILLING_SALON_NOT_FOUND)$/.test(code)) return new BillingError('SALON_NOT_FOUND', 404);
  return new BillingError('BILLING_UNAVAILABLE', 502);
};

async function readBody(request: Request): Promise<Json> {
  if (Number(request.headers.get('content-length') || 0) > 8192) throw new BillingError('REQUEST_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new BillingError('INVALID_REQUEST', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new BillingError('REQUEST_TOO_LARGE', 413); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new BillingError('INVALID_REQUEST', 400); }
}

function stripeUrl(value: unknown, host: 'checkout.stripe.com' | 'billing.stripe.com') {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname === host ? url.toString() : null;
  } catch { return null; }
}

export async function handleRequest(request: Request): Promise<Response> {
  const site = configuredSite();
  const corsOrigin = site?.origin || null;
  const origin = request.headers.get('origin');
  const json = (body: unknown, status = 200) => response(body, status, corsOrigin);
  if (origin && corsOrigin && origin !== corsOrigin) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': corsOrigin || '*', 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store',
  } });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization) || authorization.length > 16_000) return json({ error: 'AUTH_REQUIRED' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'BILLING_NOT_CONFIGURED' }, 503);

  try {
    const auth = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization }, signal: AbortSignal.timeout(12_000),
    });
    if (!auth.ok) { await auth.body?.cancel(); return json({ error: 'AUTH_REQUIRED' }, 401); }
    const user = await auth.json();
    if (!UUID.test(String(user?.id || '')) || !user.email_confirmed_at) return json({ error: 'EMAIL_CONFIRMATION_REQUIRED' }, 403);
    const body = await readBody(request);
    const salonId = String(body.salon_id || '');
    const action = body.action === undefined ? 'subscribe' : body.action;
    if (!UUID.test(salonId) || !['subscribe', 'manage', 'status'].includes(String(action))) return json({ error: 'INVALID_REQUEST' }, 400);
    const requestId = String(body.request_id || '');
    // The read-only readiness check never requires a payment request identifier.
    if (action !== 'status' && !UUID.test(requestId)) return json({ error: 'REQUEST_ID_REQUIRED' }, 400);

    const rpc = async (name: string, args: Json) => {
      const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(12_000),
      });
      const text = await result.text();
      let payload: unknown;
      try { payload = text ? JSON.parse(text) : null; } catch { throw new BillingError('BILLING_UNAVAILABLE'); }
      if (!result.ok) throw safeDatabaseError((payload as Json)?.message);
      return Array.isArray(payload) ? payload[0] : payload;
    };

    let context: BillingContext;
    try {
      context = await rpc('billing_checkout_context', { p_user_id: user.id, p_salon_id: salonId }) as BillingContext;
    } catch (error) {
      if (action === 'status' && error instanceof BillingError && error.code === 'BILLING_NOT_CONFIGURED') {
        return json({ configured: false, reason: 'BILLING_NOT_CONFIGURED' });
      }
      throw error;
    }
    // The service-only RPC independently checks the verified user and ownership.
    // Never accept an amount, currency, customer, or redirect from the browser.
    if (!context || context.salon_id !== salonId) throw new BillingError('BILLING_UNAVAILABLE');
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const priceValid = Number.isSafeInteger(context.amount_cents) && context.amount_cents !== null
      && context.amount_cents > 0 && context.amount_cents <= 1_000_000 && context.currency?.toUpperCase() === 'EUR';
    const configured = Boolean(stripeKey && site && priceValid && context.enabled && context.online_checkout_available);
    const manageConfigured = Boolean(stripeKey && site && context.stripe_customer_id && /^cus_[A-Za-z0-9_]+$/.test(context.stripe_customer_id));
    if (action === 'status') return json({ configured, manage_configured: manageConfigured, reason: configured ? undefined : 'PAYMENT_NOT_CONFIGURED' });
    if (!stripeKey || !site || (action !== 'manage' && !configured)) return json({ error: 'PAYMENT_NOT_CONFIGURED' }, 503);

    const stripe = async (path: string, parameters?: URLSearchParams, idempotencyKey?: string): Promise<Json> => {
      const result = await fetch(`https://api.stripe.com/v1/${path}`, {
        method: parameters ? 'POST' : 'GET', headers: {
          Authorization: `Bearer ${stripeKey}`, 'Stripe-Version': STRIPE_VERSION,
          ...(parameters ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        }, body: parameters?.toString(), signal: AbortSignal.timeout(15_000),
      });
      if (!result.ok) { await result.body?.cancel(); throw new BillingError('PAYMENT_PROVIDER_UNAVAILABLE'); }
      return await result.json();
    };
    const returnUrl = new URL(site);
    returnUrl.hash = 'business';
    if (action === 'manage') {
      if (!context.stripe_customer_id || !STRIPE_ID.test(context.stripe_customer_id)) throw new BillingError('SUBSCRIPTION_NOT_FOUND', 404);
      const portal = await stripe('billing_portal/sessions', new URLSearchParams({
        customer: context.stripe_customer_id, return_url: returnUrl.toString(),
      }), `eneres-portal:${salonId}:${user.id}:${requestId}`);
      const url = stripeUrl(portal.url, 'billing.stripe.com');
      if (!url) throw new BillingError('PAYMENT_PROVIDER_UNAVAILABLE');
      return json({ url, mode: 'portal' });
    }
    if (context.stripe_subscription_id && ['active', 'past_due', 'pending', 'trialing'].includes(context.subscription_status || '')) {
      return json({ error: 'BILLING_ALREADY_ACTIVE' }, 409);
    }
    // A database lease serializes checkout creation across tabs/request IDs.
    // Its amount snapshot also makes a same-key retry safe after plan edits.
    context = await rpc('billing_reserve_checkout', {
      p_user_id: user.id, p_salon_id: salonId, p_request_id: requestId,
    }) as BillingContext;
    if (!context || context.salon_id !== salonId || !Number.isSafeInteger(context.amount_cents)
      || context.amount_cents === null || context.amount_cents <= 0 || context.amount_cents > 1_000_000 || context.currency?.toUpperCase() !== 'EUR') {
      throw new BillingError('BILLING_NOT_CONFIGURED', 503);
    }
    // Reuse a still-open provider session rather than creating duplicate checkout
    // sessions when the owner clicks again with a new browser request identifier.
    if (context.reuse_checkout) {
      if (!context.stripe_checkout_id || !/^cs_[A-Za-z0-9_]+$/.test(context.stripe_checkout_id)) throw new BillingError('BILLING_UNAVAILABLE');
      const existing = await stripe(`checkout/sessions/${encodeURIComponent(context.stripe_checkout_id)}`);
      const existingUrl = stripeUrl(existing.url, 'checkout.stripe.com');
      if (existing.status === 'open' && Number(existing.expires_at) > Date.now() / 1000 && existingUrl) {
        return json({ url: existingUrl, session_id: existing.id, mode: 'subscription' });
      }
      return json({ error: 'BILLING_UPDATE_PENDING' }, 409);
    }
    const successUrl = new URL(site); successUrl.searchParams.set('billing', 'success');
    successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}'); successUrl.hash = 'business';
    const cancelUrl = new URL(site); cancelUrl.searchParams.set('billing', 'cancelled'); cancelUrl.hash = 'business';
    const parameters = new URLSearchParams({
      mode: 'subscription', client_reference_id: salonId,
      success_url: successUrl.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'),
      cancel_url: cancelUrl.toString(),
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': String(context.amount_cents),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': 'Eneres Business — Μηνιαία συνδρομή',
      'metadata[salon_id]': salonId, 'metadata[owner_id]': context.owner_id,
      'metadata[requested_by]': user.id, 'subscription_data[metadata][salon_id]': salonId,
      'subscription_data[metadata][owner_id]': context.owner_id,
    });
    if (context.stripe_customer_id && STRIPE_ID.test(context.stripe_customer_id)) parameters.set('customer', context.stripe_customer_id);
    else parameters.set('customer_email', context.owner_email);
    const session = await stripe('checkout/sessions', parameters, `eneres-monthly:${salonId}:${user.id}:${requestId}`);
    const url = stripeUrl(session.url, 'checkout.stripe.com');
    if (!url || !STRIPE_ID.test(String(session.id || ''))) throw new BillingError('PAYMENT_PROVIDER_UNAVAILABLE');
    await rpc('billing_record_checkout', {
      p_salon_id: salonId, p_user_id: user.id, p_request_id: requestId,
      p_session_id: session.id, p_checkout_url: url,
      p_customer_id: typeof session.customer === 'string' ? session.customer : null,
      p_subscription_id: typeof session.subscription === 'string' ? session.subscription : null,
    });
    return json({ url, session_id: session.id, mode: 'subscription' });
  } catch (error) {
    const failure = error instanceof BillingError ? error : new BillingError('BILLING_UNAVAILABLE');
    return json({ error: failure.code }, failure.status);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
