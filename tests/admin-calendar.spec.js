import { test, expect } from '@playwright/test';
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
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
const salon = {
  id: ids.salon, owner_id: ids.user, name: 'Πραγματικό συμβόλαιο καταστήματος',
  category: 'hair', city: 'Αθήνα', country: 'Ελλάδα', address: 'Σόλωνος 15',
  timezone: 'Europe/Athens', status: 'published', cancellation_hours: 24,
  description: 'Καταχώριση μόνο στο HTTP fixture', image_url: null,
  services: [{ id: ids.service, salon_id: ids.salon, name: 'Κούρεμα', duration_minutes: 60, price_cents: 3500, active: true }],
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
async function mockOperations(page, options = {}) {
  const state = {
    calls: [], unexpected: [], user: actor(options.admin), ownedSalons: options.noSalon ? [] : [structuredClone(salon)],
    bookings: [], failManual: false, pending: [{ ...structuredClone(salon), status: 'pending', owner_email: 'owner@example.test' }],
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
    if (path === '/auth/v1/user') return send(state.user);
    if (path === '/auth/v1/logout') return send({});
    if (path === '/rest/v1/profiles') return send([{ user_id: ids.user, full_name: state.user.user_metadata.full_name }]);
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
        id: body.p_booking_id || ids.booking, salon_id: ids.salon, service_id: body.p_service_id, staff_id: body.p_staff_id,
        starts_at: body.p_starts_at, ends_at: new Date(Date.parse(body.p_starts_at) + body.p_duration_minutes * 60000).toISOString(),
        customer_id: null, customer_name: body.p_customer_name, customer_email: body.p_customer_email,
        customer_phone: body.p_customer_phone, notes: body.p_notes, created_by: ids.user, booking_source: 'offline',
        service_name: salon.services[0].name, salon_name: salon.name, staff_name: salon.staff[0].name,
        country: salon.country, timezone: salon.timezone, cancellation_hours: 24, price_cents: body.p_price_cents,
        status: 'confirmed', payment_method: 'pay_at_salon', payment_status: 'unpaid', idempotency_key: body.p_idempotency_key,
        created_at: new Date().toISOString(),
      };
      state.bookings = [record]; return send(record);
    }
    if (path === '/rest/v1/rpc/get_availability') return send([]);
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
async function login(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
  const panel = page.locator('.account-panel');
  await panel.getByLabel('Email', { exact: true }).fill('Loukia.mic@gmail.com');
  await panel.getByLabel(/^Κωδικός πρόσβασης/).fill('isolated-test-password');
  await panel.getByRole('button', { name: 'Σύνδεση', exact: true }).click();
  await expect(panel.getByRole('heading', { name: /^Το προφίλ σας\.?$/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Κλείσιμο λογαριασμού' }).click();
}
async function openBusiness(page) {
  await login(page);
  await page.locator('.header-actions').getByRole('button', { name: /Για επαγγελματίες/ }).click();
}

test('business signup chooses a city from its country and clears a stale country selection', async ({ page }) => {
  const state = await mockOperations(page, { noSalon: true });
  await openBusiness(page);
  const country = page.getByRole('combobox', { name: 'Χώρα', exact: true });
  const city = page.getByRole('combobox', { name: 'Πόλη', exact: true });
  await expect(city.locator('option:not([disabled])')).toHaveText(['Αθήνα', 'Θεσσαλονίκη']);
  await city.selectOption('Αθήνα');
  await country.selectOption('Κύπρος');
  await expect(city).toHaveValue('');
  await expect(city.locator('option:not([disabled])')).toHaveText(['Λάρνακα', 'Λευκωσία', 'Λεμεσός', 'Πάφος', 'Παραλίμνι']);
  await city.selectOption('Λάρνακα');
  await page.getByLabel('Όνομα επιχείρησης', { exact: true }).fill('Χώρος Λάρνακας');
  await page.getByLabel('Διεύθυνση', { exact: true }).fill('Οδός Δοκιμής 20');
  await page.getByRole('button', { name: 'Δημιουργία πρόχειρης επιχείρησης', exact: true }).click();
  await expect.poll(() => state.calls.some(call => call.path.endsWith('/create_salon'))).toBe(true);
  expect(state.calls.find(call => call.path.endsWith('/create_salon')).body).toMatchObject({ p_city: 'Λάρνακα', p_country: 'Κύπρος', p_name: 'Χώρος Λάρνακας' });
  expect(state.unexpected).toEqual([]);
});

test('manual offline appointment waits for the server, preserves conflicts and edits the shared calendar row', async ({ page }) => {
  const state = await mockOperations(page);
  await openBusiness(page);
  await expect(page.getByRole('button', { name: 'Νέο ραντεβού', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Νέο ραντεβού', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Νέο χειροκίνητο ραντεβού', exact: true });
  await form.getByLabel('Όνομα πελάτη', { exact: true }).fill('Πελάτης Τηλεφώνου');
  await form.getByLabel('Τηλέφωνο πελάτη (προαιρετικό)', { exact: true }).fill('99123456');
  await form.getByLabel('Ημερομηνία', { exact: true }).fill(today());
  await form.getByLabel('Ώρα', { exact: true }).fill('16:00');
  await form.getByLabel('Διάρκεια (λεπτά)', { exact: true }).fill('45');
  await form.getByLabel('Τιμή (€)', { exact: true }).fill('30');
  await form.getByLabel('Σημειώσεις (προαιρετικές)', { exact: true }).fill('Τηλεφωνική κράτηση');
  state.failManual = true;
  await form.getByRole('button', { name: 'Προσθήκη ραντεβού', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByLabel('Όνομα πελάτη', { exact: true })).toHaveValue('Πελάτης Τηλεφώνου');
  await expect(page.locator('.lb-booking-row')).toHaveCount(0);
  state.failManual = false;
  await form.getByRole('button', { name: 'Προσθήκη ραντεβού', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator('.lb-booking-row')).toContainText('Πελάτης Τηλεφώνου');
  await expect(page.locator('.lb-booking-row')).toContainText('Χειροκίνητο');
  const requests = state.calls.filter(call => call.path.endsWith('/create_manual_booking'));
  expect(requests).toHaveLength(2);
  expect(requests[0].body.p_idempotency_key).toBe(requests[1].body.p_idempotency_key);
  expect(requests[1].body).toMatchObject({ p_salon_id: ids.salon, p_customer_name: 'Πελάτης Τηλεφώνου', p_customer_phone: '99123456', p_duration_minutes: 45, p_price_cents: 3000 });
  expect(requests[1].body).not.toHaveProperty('p_customer_id');
  await page.locator('.lb-booking-row').click();
  const detail = page.getByRole('dialog', { name: 'Λεπτομέρειες ραντεβού', exact: true });
  await expect(detail).toContainText('99123456');
  await detail.getByRole('button', { name: 'Επεξεργασία ραντεβού', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Επεξεργασία χειροκίνητου ραντεβού', exact: true });
  await edit.getByLabel('Τηλέφωνο πελάτη (προαιρετικό)', { exact: true }).fill('99998888');
  await edit.getByLabel('Ώρα', { exact: true }).fill('17:00');
  await edit.getByRole('button', { name: 'Αποθήκευση αλλαγών', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.locator('.lb-booking-row')).toContainText('17:00');
  const edited = state.calls.find(call => call.path.endsWith('/edit_manual_booking'));
  expect(edited.body).toMatchObject({ p_booking_id: ids.booking, p_customer_phone: '99998888' });
  expect(state.bookings[0]).toMatchObject({ customer_id: null, booking_source: 'offline', customer_phone: '99998888' });
  expect(state.calls.some(call => call.path.includes('/functions/'))).toBe(false);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Νέο ραντεβού', exact: true }).click();
    const manual = page.getByRole('dialog', { name: 'Νέο χειροκίνητο ραντεβού', exact: true });
    const bounds = await manual.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await manual.getByRole('button', { name: 'Κλείσιμο', exact: true }).click();
  }
  expect(state.unexpected).toEqual([]);
});


test('matching admin email and editable metadata do not grant administrative access', async ({ page }) => {
  const state = await mockOperations(page);
  await login(page);
  await page.goto('/#admin');
  await expect(page.getByText('Αυτός ο λογαριασμός δεν έχει πρόσβαση διαχείρισης', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Ενότητες διαχείρισης' })).toHaveCount(0);
  expect(state.calls.some(call => /\/rpc\/(admin_|get_platform_billing)/.test(call.path))).toBe(false);
  expect(state.user.email).toBe('Loukia.mic@gmail.com');
  expect(state.user.user_metadata.role).toBe('admin');
  expect(state.user.app_metadata.role).toBeUndefined();
  expect(state.unexpected).toEqual([]);
});

test('trusted administrator sees server statistics and approves a request into the public directory', async ({ page }) => {
  const state = await mockOperations(page, { admin: true });
  await login(page);
  await page.goto('/#admin');
  await expect(page.getByRole('heading', { name: 'Διαχείριση Eneres', exact: true })).toBeVisible();
  await expect(page.locator('.en-admin-stat').filter({ hasText: 'Ραντεβού περιόδου' })).toContainText('37');
  await page.getByRole('navigation', { name: 'Ενότητες διαχείρισης' }).getByRole('button', { name: /Αιτήματα επιχειρήσεων/ }).click();
  await page.getByRole('button', { name: `Έλεγχος ${salon.name}`, exact: true }).click();
  const review = page.getByRole('region', { name: `Έλεγχος ${salon.name}`, exact: true });
  await expect(review).toContainText('owner@example.test');
  await expect(review).toContainText('Ελένη Επαγγελματίας');
  await review.getByLabel('Σημείωση ελέγχου', { exact: true }).fill('Ελέγχθηκαν τα πραγματικά στοιχεία');
  await review.getByRole('button', { name: 'Έγκριση επιχείρησης', exact: true }).click();
  await expect.poll(() => state.pending[0].status).toBe('published');
  await expect(review).toContainText('Δημοσιευμένη');
  const decision = state.calls.find(call => call.path.endsWith('/admin_review_salon'));
  expect(decision.body).toEqual({ p_salon_id: ids.salon, p_decision: 'published', p_note: 'Ελέγχθηκαν τα πραγματικά στοιχεία' });
  expect(decision.authorization).toMatch(/^Bearer /);
  await page.getByRole('button', { name: 'Ιστότοπος', exact: true }).click();
  await expect(page.locator('.salon-card')).toContainText(salon.name);
  expect(state.calls.some(call => call.path === '/rest/v1/salons' && call.method !== 'GET')).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('administrator must explain a rejected request and the server decision is shown', async ({ page }) => {
  const state = await mockOperations(page, { admin: true });
  await login(page);
  await page.goto('/#admin');
  await page.getByRole('navigation', { name: 'Ενότητες διαχείρισης' }).getByRole('button', { name: /Αιτήματα επιχειρήσεων/ }).click();
  await page.getByRole('button', { name: `Έλεγχος ${salon.name}`, exact: true }).click();
  const review = page.getByRole('region', { name: `Έλεγχος ${salon.name}`, exact: true });
  await review.getByRole('button', { name: 'Απόρριψη αιτήματος', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('Γράψτε τι χρειάζεται');
  expect(state.calls.some(call => call.path.endsWith('/admin_review_salon'))).toBe(false);
  await review.getByLabel('Σημείωση ελέγχου', { exact: true }).fill('Χρειάζεται πλήρες ωράριο και φωτογραφία');
  await review.getByRole('button', { name: 'Απόρριψη αιτήματος', exact: true }).click();
  await expect.poll(() => state.pending[0].status).toBe('rejected');
  await expect(review).toContainText('Χρειάζεται αλλαγές');
  expect(state.calls.find(call => call.path.endsWith('/admin_review_salon')).body).toMatchObject({ p_decision: 'rejected', p_note: 'Χρειάζεται πλήρες ωράριο και φωτογραφία' });
  expect(state.unexpected).toEqual([]);
});

test('monthly plan and business charges use administrator RPCs without pretending to charge a card', async ({ page }) => {
  const state = await mockOperations(page, { admin: true });
  await login(page);
  await page.goto('/#admin');
  await page.getByRole('navigation', { name: 'Ενότητες διαχείρισης' }).getByRole('button', { name: 'Μηνιαίες συνδρομές', exact: true }).click();
  await page.getByLabel('Μηνιαία συνδρομή (€)', { exact: true }).fill('29.90');
  await page.getByRole('checkbox', { name: 'Ενεργή μηνιαία συνδρομή', exact: true }).check();
  await page.getByRole('button', { name: 'Αποθήκευση τιμής', exact: true }).click();
  await expect.poll(() => state.billing.monthly_price_cents).toBe(2990);
  expect(state.calls.find(call => call.path.endsWith('/admin_set_platform_billing')).body).toEqual({ p_monthly_price_cents: 2990, p_enabled: true });
  await page.getByRole('combobox', { name: 'Επιχείρηση για χρέωση', exact: true }).selectOption(ids.salon);
  await page.getByLabel('Ειδική μηνιαία τιμή (€)', { exact: true }).fill('29.90');
  await page.getByRole('combobox', { name: 'Κατάσταση συνδρομής', exact: true }).selectOption('pending');
  await page.getByRole('button', { name: 'Αποθήκευση συνδρομής', exact: true }).click();
  await expect.poll(() => state.subscriptions.length).toBe(1);
  await page.getByLabel('Ποσό χρέωσης (€)', { exact: true }).fill('29.90');
  await page.getByRole('button', { name: 'Δημιουργία μηνιαίας χρέωσης', exact: true }).click();
  await expect.poll(() => state.charges.length).toBe(1);
  await expect(page.locator('.en-admin-charges')).toContainText('Σε εκκρεμότητα');
  expect(state.charges[0]).toMatchObject({ amount_cents: 2990, currency: 'EUR', status: 'pending', payment_provider: 'manual' });
  expect(state.calls.some(call => call.path.includes('/functions/'))).toBe(false);
  await page.getByRole('button', { name: 'Καταχώριση εξόφλησης', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Καταχώριση εξόφλησης', exact: true });
  await expect(confirmation).toContainText('έχει ήδη εισπραχθεί');
  await confirmation.getByLabel('Αναφορά πληρωμής', { exact: true }).fill('Τραπεζική κατάθεση 123');
  await confirmation.getByRole('button', { name: 'Επιβεβαίωση εξόφλησης', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.en-admin-charges')).toContainText('Εξοφλημένη');
  expect(state.calls.find(call => call.path.endsWith('/admin_set_charge_status')).body).toEqual({ p_charge_id: ids.charge, p_status: 'paid', p_reference: 'Τραπεζική κατάθεση 123' });
  expect(state.charges[0].paid_at).toBeTruthy();
  expect(state.unexpected).toEqual([]);
});

test('business billing reports an unconfigured card provider without fake activation or charges', async ({ page }) => {
  const state = await mockOperations(page, { billing: { monthly_price_cents: 2990, enabled: true, currency: 'EUR', stripe_enabled: false } });
  await openBusiness(page);
  await page.getByRole('navigation', { name: 'Διαχείριση επιχείρησης' }).getByRole('button', { name: 'Η συνδρομή σας', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Συνδρομή Eneres', exact: true })).toBeVisible();
  await expect(page.getByText('Η πληρωμή με κάρτα δεν είναι διαθέσιμη ακόμη', { exact: true })).toBeVisible();
  await expect(page.getByText('Χωρίς ενεργή συνδρομή', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ενεργοποίηση μηνιαίας συνδρομής με κάρτα', exact: true })).toHaveCount(0);
  const providerCalls = state.calls.filter(call => call.path.includes('/functions/'));
  expect(providerCalls).toHaveLength(1);
  expect(providerCalls[0].body).toMatchObject({ salon_id: ids.salon, action: 'status' });
  expect(state.calls.some(call => call.path.endsWith('/admin_create_business_charge') || call.body?.action === 'subscribe')).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('existing Stripe subscription can still be managed when new sales are disabled', async ({ page }) => {
  const state = await mockOperations(page, {
    billing: { monthly_price_cents: 2990, enabled: false, currency: 'EUR', stripe_enabled: false },
    subscriptions: [{ id: 'existing-subscription', salon_id: ids.salon, monthly_price_cents: 2990, currency: 'EUR', status: 'active', payment_provider: 'stripe', stripe_customer_id: 'cus_isolated', current_period_end: '2026-11-25T10:00:00Z' }],
    providerStatus: { configured: false, manage_configured: true },
  });
  await openBusiness(page);
  await page.getByRole('navigation', { name: 'Διαχείριση επιχείρησης' }).getByRole('button', { name: 'Η συνδρομή σας', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Διαχείριση πληρωμών', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ενεργοποίηση μηνιαίας συνδρομής με κάρτα', exact: true })).toHaveCount(0);
  await expect(page.getByText('Η πληρωμή με κάρτα δεν είναι διαθέσιμη ακόμη', { exact: true })).toHaveCount(0);
  await expect(page.locator('.en-billing-plan')).toContainText('Επόμενη ανανέωση 25 Νοε 2026');
  const providerCalls = state.calls.filter(call => call.path.includes('/functions/'));
  expect(providerCalls).toHaveLength(1);
  expect(providerCalls[0].body).toMatchObject({ salon_id: ids.salon, action: 'status' });
  expect(state.unexpected).toEqual([]);
});

async function openPhotoSettings(page) {
  await openBusiness(page);
  await page.getByRole('navigation', { name: 'Διαχείριση επιχείρησης' }).getByRole('button', { name: 'Η επιχείρησή μου', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Στοιχεία επιχείρησης', exact: true })).toBeVisible();
  return page.locator('.lb-content').locator('form').first();
}
const salonPhoto = () => ({ name: 'my-salon.png', mimeType: 'image/png', buffer: readFileSync('public/images/eneres-flower.png') });

test('business photo selection previews locally before a real storage upload and saved public listing', async ({ page }) => {
  const state = await mockOperations(page);
  const form = await openPhotoSettings(page);
  const input = form.getByRole('button', { name: 'Φωτογραφία επιχείρησης', exact: true });
  await expect(input).toHaveAttribute('type', 'file');
  await expect(form.locator('input[type="url"]')).toHaveCount(0);
  await input.setInputFiles(salonPhoto());
  const preview = form.getByRole('img', { name: 'Προεπισκόπηση φωτογραφίας επιχείρησης', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', /^blob:/);
  expect(state.uploads).toHaveLength(0);
  expect(state.calls.some(call => call.path === '/rest/v1/salons' && call.method === 'PATCH')).toBe(false);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await form.locator('.lb-photo-preview').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  }
  await form.getByRole('button', { name: 'Αποθήκευση αλλαγών', exact: true }).click();
  await expect.poll(() => state.uploads.length).toBe(1);
  await expect.poll(() => state.calls.some(call => call.path === '/rest/v1/salons' && call.method === 'PATCH')).toBe(true);
  expect(state.uploads[0].path).toMatch(new RegExp(`^${ids.salon}/[0-9a-f-]{36}\\.png$`));
  expect(state.uploads[0].bytes).toBeGreaterThan(0);
  expect(state.uploads[0].headers.authorization).toMatch(/^Bearer /);
  expect(state.uploads[0].headers['x-upsert']).toBe('false');
  const savedUrl = `${HOST}/storage/v1/object/public/salon-photos/${state.uploads[0].path}`;
  const patch = state.calls.find(call => call.path === '/rest/v1/salons' && call.method === 'PATCH');
  expect(patch.body.image_url).toBe(savedUrl);
  expect(JSON.stringify(patch.body)).not.toContain('blob:');
  expect(JSON.stringify(patch.body)).not.toContain('data:image');
  await expect(preview).toHaveAttribute('src', savedUrl);
  await page.locator('.lb-back').click();
  await expect(page.locator('.salon-photo-button img')).toHaveAttribute('src', savedUrl);
  expect(state.removals).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('photo upload and database failures preserve the existing photo and never claim a saved change', async ({ page }) => {
  const oldUrl = `${HOST}/storage/v1/object/public/salon-photos/${ids.salon}/old-salon.png`;
  const state = await mockOperations(page, { ownedSalons: [{ ...structuredClone(salon), image_url: oldUrl }], failUpload: true });
  const form = await openPhotoSettings(page);
  await expect(form.getByRole('img', { name: 'Προεπισκόπηση φωτογραφίας επιχείρησης', exact: true })).toHaveAttribute('src', oldUrl);
  await form.getByRole('button', { name: 'Φωτογραφία επιχείρησης', exact: true }).setInputFiles(salonPhoto());
  await expect(form.getByRole('img', { name: 'Προεπισκόπηση φωτογραφίας επιχείρησης', exact: true })).toHaveAttribute('src', /^blob:/);
  await form.getByRole('button', { name: 'Αποθήκευση αλλαγών', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(state.calls.filter(call => call.path === '/rest/v1/salons' && call.method === 'PATCH')).toHaveLength(0);
  expect(state.ownedSalons[0].image_url).toBe(oldUrl);
  await expect(form.getByRole('img', { name: 'Προεπισκόπηση φωτογραφίας επιχείρησης', exact: true })).toHaveAttribute('src', /^blob:/);
  state.failUpload = false; state.failSalonSave = 'network';
  await form.getByRole('button', { name: 'Αποθήκευση αλλαγών', exact: true }).click();
  await expect.poll(() => state.calls.filter(call => call.path === '/rest/v1/salons' && call.method === 'PATCH').length).toBe(1);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Αποθήκευση αλλαγών', exact: true })).toBeEnabled();
  expect(state.removals).toEqual([]);
  expect(state.calls.filter(call => call.path === '/rest/v1/salons' && call.method === 'GET' && call.params.select === 'image_url')).toEqual([]);
  expect(state.ownedSalons[0].image_url).toBe(oldUrl);
  await expect(form.getByRole('img', { name: 'Προεπισκόπηση φωτογραφίας επιχείρησης', exact: true })).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('.lb-global-messages')).not.toContainText('Τα στοιχεία της επιχείρησης αποθηκεύτηκαν');
  expect(state.unexpected).toEqual([]);
});

test('business photos reject unsafe file types, oversized images and invalid image bytes before upload', async ({ page }) => {
  const state = await mockOperations(page);
  const form = await openPhotoSettings(page);
  const input = form.getByRole('button', { name: 'Φωτογραφία επιχείρησης', exact: true });
  for (const file of [
    { name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') },
    { name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
    { name: 'not-an-image.png', mimeType: 'image/png', buffer: Buffer.from('This is not a valid image') },
  ]) {
    await input.setInputFiles(file);
    await expect(form.getByRole('alert')).toBeVisible();
    expect(state.uploads).toEqual([]);
    expect(state.calls.filter(call => call.path === '/rest/v1/salons' && call.method === 'PATCH')).toEqual([]);
  }
  expect(state.unexpected).toEqual([]);
});
