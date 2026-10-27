import { readFileSync } from 'node:fs';

// These tests exercise the real React interfaces and adapters against isolated
// HTTP fixtures. They never contact a hosted project or send real payments/mail.
const HOST = 'https://eneres-operations-test.supabase.co';
const ids = {
  user: '10000000-0000-4000-8000-000000000001',
  salon: '10000000-0000-4000-8000-000000000002',
  service: '10000000-0000-4000-8000-000000000003',
  staff: '10000000-0000-4000-8000-000000000004',
  booking: '10000000-0000-4000-8000-000000000005',
  charge: '10000000-0000-4000-8000-000000000006',
  alert: '10000000-0000-4000-8000-000000000007',
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
const salon = {
  id: ids.salon, owner_id: ids.user, name: 'Πραγματικό συμβόλαιο καταστήματος',
  category: 'hair', city: 'Αθήνα', country: 'Ελλάδα', address: 'Σόλωνος 15',
  timezone: 'Europe/Athens', status: 'published', cancellation_hours: 24,
  description: 'Καταχώριση μόνο στο HTTP fixture', image_url: null,
  services: [{ id: ids.service, salon_id: ids.salon, name: 'Custom service — ειδική υπηρεσία', duration_minutes: 60, price_cents: 3500, active: true }],
  staff: [{ id: ids.staff, salon_id: ids.salon, name: 'Ελένη Επαγγελματίας', active: true }],
};
function actor(admin = false) {
  return {
    id: ids.user, aud: 'authenticated', role: 'authenticated', email: 'Loukia.mic@gmail.com',
    email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'], ...(admin ? { role: 'admin' } : {}) },
    // Untrusted editable metadata must never turn this account into an admin.
    user_metadata: { full_name: 'Λουκία Δοκιμή', role: 'admin' },
    identities: [], created_at: '2026-01-01T00:00:00Z',
  };
}
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', app_metadata: user.app_metadata, iat: now, exp: now + 3600 })).toString('base64url')}.test-signature`;
  return { access_token: token, refresh_token: 'isolated-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
}
async function mockLanguagePlatform(page, options = {}) {
  if (options.language) await page.addInitScript(language => { if (!localStorage.getItem('eneres-language')) localStorage.setItem('eneres-language', language); }, options.language);
  const state = {
    calls: [], unexpected: [], user: actor(options.admin), ownedSalons: options.noSalon ? [] : [structuredClone(salon)],
    bookings: [], alerts: [], profile: { user_id: ids.user, full_name: 'Λουκία Δοκιμή', mobile_phone: '+35799123456' }, failManual: false, pending: [{ ...structuredClone(salon), status: 'pending', owner_email: 'owner@example.test' }],
    charges: [], subscriptions: [], billing: { monthly_price_cents: null, enabled: false, currency: 'EUR', stripe_enabled: false },
    providerStatus: { configured: false, manage_configured: false }, uploads: [], removals: [], failUpload: false, failSalonSave: false, ...options,
  };
  await page.route('**/platform-config*.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.MERAKI_CONFIG=${JSON.stringify({ supabaseUrl: HOST, supabasePublishableKey: 'sb_publishable_isolated_test' })};` }));
  await page.route(`${HOST}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let body;
    try { body = request.postDataJSON(); } catch { body = null; }
    state.calls.push({ method: request.method(), path, body, params: Object.fromEntries(url.searchParams), authorization: request.headers().authorization });
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' } });
    if (path.startsWith('/storage/v1/object/public/salon-photos/') && request.method() === 'GET') return route.fulfill({ contentType: 'image/png', body: readFileSync('public/images/eneres-flower.png') });
    if (path.startsWith('/storage/v1/object/salon-photos/') && request.method() === 'POST') {
      if (state.failUpload) return send({ statusCode: '404', error: 'not_found', message: 'Bucket not found' }, 400);
      const objectPath = path.slice('/storage/v1/object/salon-photos/'.length);
      state.uploads.push({ path: objectPath, bytes: request.postDataBuffer()?.length || 0, headers: request.headers() });
      return send({ Id: crypto.randomUUID(), Key: `salon-photos/${objectPath}` });
    }
    if (path === '/storage/v1/object/salon-photos' && request.method() === 'DELETE') { state.removals.push(...body.prefixes); return send(body.prefixes.map(name => ({ name }))); }
    if (path === '/auth/v1/token') return send(session(state.user));
    if (path === '/rest/v1/rpc/get_auth_requirements') return send({ require_verified_phone: false });
    if (path === '/auth/v1/user') return send(state.user);
    if (path === '/auth/v1/logout') return send({});
    if (path === '/rest/v1/profiles') { if (request.method() === 'GET') return send([state.profile]); Object.assign(state.profile, body); return send(null); }
    if (path === '/rest/v1/salons') {
      if (request.method() === 'PATCH') {
        if (state.failSalonSave === 'network') return route.abort('failed');
        if (state.failSalonSave) return send({ code: '42501', message: 'Database update rejected' }, 403);
        const selected = state.ownedSalons.find(entry => entry.id === url.searchParams.get('id')?.slice(3));
        Object.assign(selected, body);
        return send(selected);
      }
      if (url.searchParams.has('owner_id')) return send(state.ownedSalons);
      if (url.searchParams.has('id')) return send(state.ownedSalons.find(entry => entry.id === url.searchParams.get('id').slice(3)) || null);
      const directory = state.user.app_metadata?.role === 'admin' ? state.pending : state.ownedSalons;
      return send(directory.filter(entry => entry.status === 'published'));
    }
    if (path === '/rest/v1/staff_hours') return send([{ id: 'test-hour', staff_id: ids.staff, weekday: 1, opens_at: '09:00:00', closes_at: '18:00:00' }]);
    if (path === '/rest/v1/staff_time_off') return send([]);
    if (path === '/rest/v1/bookings') return send(state.bookings);
    if (path === '/rest/v1/rpc/create_salon') {
      const created = { ...structuredClone(salon), name: body.p_name, city: body.p_city, country: body.p_country, address: body.p_address, status: 'draft', services: [], staff: [] };
      state.ownedSalons = [created]; return send(created);
    }
    if (path === '/rest/v1/rpc/create_manual_booking' || path === '/rest/v1/rpc/edit_manual_booking') {
      if (state.failManual) return send({ code: '23P01', message: 'bookings_staff_no_overlap' }, 409);
      const record = {
        id: body.p_booking_id || (state.bookings.some(row => row.id === ids.booking) ? crypto.randomUUID() : ids.booking), salon_id: ids.salon, service_id: body.p_service_id, staff_id: body.p_staff_id,
        starts_at: body.p_starts_at, ends_at: new Date(Date.parse(body.p_starts_at) + body.p_duration_minutes * 60000).toISOString(),
        customer_id: null, customer_name: body.p_customer_name, customer_email: body.p_customer_email,
        customer_phone: body.p_customer_phone, notes: body.p_notes, created_by: ids.user, booking_source: 'offline',
        service_name: salon.services[0].name, salon_name: salon.name, staff_name: state.ownedSalons[0].staff.find(member => member.id === body.p_staff_id)?.name || salon.staff[0].name,
        country: salon.country, timezone: salon.timezone, cancellation_hours: 24, price_cents: body.p_price_cents,
        status: 'confirmed', payment_method: 'pay_at_salon', payment_status: 'unpaid', idempotency_key: body.p_idempotency_key,
        created_at: new Date().toISOString(),
      };
      state.bookings = [...state.bookings.filter(row => row.id !== record.id), record]; return send(record);
    }
    if (path === '/rest/v1/rpc/list_business_booking_alerts') return send(state.alerts.slice(body.p_offset || 0, (body.p_offset || 0) + (body.p_limit || 100)));
    if (path === '/rest/v1/rpc/acknowledge_business_booking') {
      const alert = state.alerts.find(entry => entry.id === body.p_alert_id);
      Object.assign(alert, { status: 'noted', noted_at: new Date().toISOString() });
      return send(alert);
    }
    if (path === '/rest/v1/rpc/cancel_business_booking' || path === '/rest/v1/rpc/cancel_booking_with_note') {
      const alert = state.alerts.find(entry => entry.id === body.p_alert_id || entry.booking_id === body.p_booking_id);
      if (alert) Object.assign(alert, { status: 'cancelled', booking_status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_note: body.p_reason, booking: { ...alert.booking, status: 'cancelled', cancellation_note: body.p_reason } });
      const booking = state.bookings.find(entry => entry.id === (body.p_booking_id || alert?.booking_id));
      if (booking) Object.assign(booking, { status: 'cancelled', cancellation_note: body.p_reason });
      return send(path.endsWith('/cancel_business_booking') ? alert : booking);
    }
    if (path === '/rest/v1/rpc/get_availability') return send([10, 12].map(hour => {
      const date = body.p_date;
      const midday = new Date(`${date}T12:00:00Z`);
      const offset = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: 'numeric', hourCycle: 'h23' }).format(midday)) - 12;
      const starts_at = new Date(`${date}T${String(hour-offset).padStart(2, '0')}:00:00Z`).toISOString();
      return { staff_id: ids.staff, staff_name: salon.staff[0].name, starts_at, ends_at: new Date(Date.parse(starts_at)+3600000).toISOString(), local_time: `${hour}:00` };
    }));
    if (path === '/rest/v1/rpc/create_booking_with_contact') {
      const record = {
        id: ids.booking, salon_id: ids.salon, service_id: body.p_service_id, staff_id: body.p_staff_id,
        starts_at: body.p_starts_at, ends_at: new Date(Date.parse(body.p_starts_at)+3600000).toISOString(),
        customer_id: ids.user, customer_name: body.p_customer_name, customer_email: state.user.email, customer_phone: body.p_customer_phone, notes: body.p_notes,
        service_name: salon.services[0].name, salon_name: salon.name, staff_name: salon.staff[0].name, country: salon.country, timezone: salon.timezone,
        cancellation_hours: 24, price_cents: 3500, status: 'confirmed', payment_method: 'pay_at_salon', payment_status: 'unpaid', booking_source: 'online',
        idempotency_key: body.p_idempotency_key, created_at: new Date().toISOString(),
      };
      state.bookings = [...state.bookings, record]; return send(record);
    }
    if (path === '/rest/v1/rpc/get_business_billing') return send({ plan: state.billing, online_checkout_available: false, subscription: state.subscriptions.find(entry => entry.salon_id === body.p_salon_id) || null, charges: state.charges.filter(entry => entry.salon_id === body.p_salon_id), reviews: [] });
    if (path === '/rest/v1/rpc/admin_overview') {
      const counts = { salons: state.pending.length, pending: state.pending.filter(entry => entry.status === 'pending').length, published: state.pending.filter(entry => entry.status === 'published').length, owners: state.pending.length, bookings: 37, confirmed: 21, completed: 12, cancelled: 4 };
      const paid = state.charges.filter(entry => entry.status === 'paid').reduce((sum, entry) => sum + entry.amount_cents, 0);
      const outstanding = state.charges.filter(entry => entry.status === 'pending').reduce((sum, entry) => sum + entry.amount_cents, 0);
      return send({ days: body.p_days, counts, stats: { ...counts, pending_salons: counts.pending, published_salons: counts.published, confirmed_bookings: counts.confirmed, completed_bookings: counts.completed, cancelled_bookings: counts.cancelled, service_revenue_cents: 42000, subscription_revenue_cents: paid, outstanding_charges_cents: outstanding }, revenue: { bookings_cents: 42000, subscriptions_cents: paid, outstanding_cents: outstanding }, daily: [{ date: today(), bookings: 37, service_revenue_cents: 42000, venue_revenue_cents: 42000, platform_revenue_cents: paid }], billing: state.billing });
    }
    if (path === '/rest/v1/rpc/admin_list_salons') return send(state.pending.filter(entry => !body.p_status || entry.status === body.p_status).map(entry => ({ ...entry, owner_email: 'owner@example.test', owner_name: 'Ιδιοκτήτης Καταστήματος', subscription: state.subscriptions.find(subscription => subscription.salon_id === entry.id) || null, booking_count: 37 })));
    if (path === '/rest/v1/rpc/admin_get_salon') {
      const selected = state.pending.find(entry => entry.id === body.p_salon_id);
      return send({ salon: selected, owner: { id: ids.user, email: 'owner@example.test', full_name: 'Ιδιοκτήτης Καταστήματος', name: 'Ιδιοκτήτης Καταστήματος', confirmed: true }, staff: salon.staff, services: salon.services, hours: [{ id: 'test-hour', staff_id: ids.staff, weekday: 1, opens_at: '09:00:00', closes_at: '18:00:00' }], reviews: selected.reviews || [], subscription: state.subscriptions.find(entry => entry.salon_id === selected.id) || null, charges: state.charges.filter(entry => entry.salon_id === selected.id) });
    }
    if (path === '/rest/v1/rpc/admin_review_salon') {
      const selected = state.pending.find(entry => entry.id === body.p_salon_id);
      selected.status = body.p_decision;
      selected.reviews = [{ decision: body.p_decision, note: body.p_note, created_at: new Date().toISOString() }];
      return send(selected);
    }
    if (path === '/rest/v1/rpc/get_platform_billing') return send(state.billing);
    if (path === '/rest/v1/rpc/admin_set_platform_billing') {
      state.billing = { ...state.billing, monthly_price_cents: body.p_monthly_price_cents, enabled: body.p_enabled };
      return send(state.billing);
    }
    if (path === '/rest/v1/rpc/admin_set_business_subscription') {
      const subscription = { id: 'test-subscription', salon_id: body.p_salon_id, monthly_price_cents: body.p_monthly_price_cents ?? state.billing.monthly_price_cents, status: body.p_status, payment_provider: body.p_provider, currency: 'EUR' };
      state.subscriptions = [...state.subscriptions.filter(entry => entry.salon_id !== subscription.salon_id), subscription];
      return send(subscription);
    }
    if (path === '/rest/v1/rpc/admin_create_business_charge') {
      const charge = { id: ids.charge, salon_id: body.p_salon_id, amount_cents: body.p_amount_cents ?? state.billing.monthly_price_cents, currency: 'EUR', period_start: body.p_period_start, period_end: body.p_period_end, due_date: body.p_due_date || body.p_period_start, status: 'pending', payment_provider: 'manual', paid_at: null, external_reference: '', created_at: new Date().toISOString() };
      state.charges.push(charge); return send(charge);
    }
    if (path === '/rest/v1/rpc/admin_set_charge_status') {
      const charge = state.charges.find(entry => entry.id === body.p_charge_id);
      Object.assign(charge, { status: body.p_status, paid_at: body.p_status === 'paid' ? new Date().toISOString() : null, external_reference: body.p_reference });
      return send(charge);
    }
    if (path === '/functions/v1/create-subscription-checkout') return send(state.providerStatus);
    state.unexpected.push(`${request.method()} ${path}`);
    return send({ message: `Unexpected isolated request: ${request.method()} ${path}` }, 400);
  });
  return state;
}

export { mockLanguagePlatform, salon, ids, today };
