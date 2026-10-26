import { test, expect } from '@playwright/test';

// Contract-level browser tests: every Supabase request is intercepted locally.
// These exercise the real React/Auth/REST adapter, not a hosted Supabase project.
const HOST = 'https://eneres-test.supabase.co';
const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  salon: '00000000-0000-4000-8000-000000000002',
  service: '00000000-0000-4000-8000-000000000003',
  staff: '00000000-0000-4000-8000-000000000004',
  booking: '00000000-0000-4000-8000-000000000005',
  draft: '00000000-0000-4000-8000-000000000006',
};
const publicSalon = {
  id: ids.salon, owner_id: 'another-owner', name: 'Δημοσιευμένος Χώρος',
  category: 'hair', city: 'Αθήνα', country: 'Ελλάδα', address: 'Σόλωνος 10',
  timezone: 'Europe/Athens', status: 'published', cancellation_hours: 24,
  description: "Καταχώριση από την απάντηση του καταλόγου", image_url: null,
  services: [{ id: ids.service, salon_id: ids.salon, name: 'Κούρεμα από κατάλογο', duration_minutes: 60, price_cents: 3500, active: true }],
  staff: [{ id: ids.staff, salon_id: ids.salon, name: 'Επαγγελματίας Διακομιστή', active: true }],
};
const account = {
  id: ids.user, aud: 'authenticated', role: 'authenticated', email: 'verified@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Ελένη Δοκιμή' }, identities: [], created_at: '2026-01-01T00:00:00Z',
};
const futureDate = (days = 7) => {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
function localInstant(date, hour = 10) {
  const midday = new Date(`${date}T12:00:00Z`);
  const offset = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: 'numeric', hourCycle: 'h23' }).format(midday)) - 12;
  return new Date(`${date}T${String(hour - offset).padStart(2, '0')}:00:00Z`).toISOString();
}
const oneHourLater = instant => new Date(Date.parse(instant) + 3600000).toISOString();
function session() {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: ids.user, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.test-signature`;
  return { access_token: jwt, refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: account };
}

async function mockPlatform(page, options = {}) {
  const state = { calls: [], unexpected: [], bookings: [], owners: [], alerts: [], profile: { user_id: ids.user, full_name: 'Ελένη Δοκιμή', mobile_phone: '' }, failCreate: false, holdCreate: false, createPending: false, releaseCreate: null, ...options };
  await page.route('**/platform-config.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.MERAKI_CONFIG=${JSON.stringify({ supabaseUrl: HOST, supabasePublishableKey: 'sb_publishable_test_key' })};` }));
  await page.route(`${HOST}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const body = request.postDataJSON();
    state.calls.push({ method: request.method(), path, params: Object.fromEntries(url.searchParams), body, authorization: request.headers().authorization });
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' } });
    if (path === '/auth/v1/signup') return send({ user: { ...account, email_confirmed_at: null, confirmed_at: null }, session: null });
    if (path === '/auth/v1/token') return send(session());
    if (path === '/auth/v1/user') return send(account);
    if (path === '/auth/v1/logout') return send({});
    if (path === '/rest/v1/profiles') {
      if (request.method() === 'GET') return send([state.profile]);
      Object.assign(state.profile, body); return send(null);
    }
    if (path === '/rest/v1/salons') {
      if (url.searchParams.has('owner_id')) return send(state.owners);
      if (url.searchParams.has('id')) {
        const id = url.searchParams.get('id').slice(3);
        const salon = [publicSalon, ...state.owners].find(entry => entry.id === id);
        return send(salon || null);
      }
      return send([publicSalon]);
    }
    if (path === '/rest/v1/staff') return send(publicSalon.staff[0]);
    if (path === '/rest/v1/staff_hours' || path === '/rest/v1/staff_time_off') return send([]);
    if (path === '/rest/v1/bookings') return send(state.bookings);
    if (path === '/rest/v1/rpc/list_business_booking_alerts') return send(state.alerts);
    if (path === '/rest/v1/rpc/get_availability') {
      if (state.failAvailability) return send({ message: 'Availability service temporarily unavailable' }, 503);
      return send((state.unavailableDates?.includes(body.p_date) ? [] : [10, 12]).map(hour => {
        const starts_at = localInstant(body.p_date, hour);
        return { staff_id: ids.staff, staff_name: publicSalon.staff[0].name, starts_at, ends_at: oneHourLater(starts_at), local_time: `${hour}:00` };
      }));
    }
    if (path === '/rest/v1/rpc/create_booking_with_contact') {
      if (state.failCreate) return send({ code: '23P01', message: 'slot_taken: booking overlap' }, 409);
      if (state.holdCreate) { state.createPending = true; await new Promise(resolve => { state.releaseCreate = resolve; }); }
      const booking = {
        id: ids.booking, salon_id: ids.salon, service_id: body.p_service_id, staff_id: body.p_staff_id,
        starts_at: body.p_starts_at, ends_at: oneHourLater(body.p_starts_at),
        customer_id: ids.user, customer_name: body.p_customer_name, customer_email: account.email, customer_phone: body.p_customer_phone, notes: body.p_notes, booking_source: 'online',
        service_name: 'Κούρεμα από κατάλογο', price_cents: 3500, status: 'confirmed',
        payment_method: 'pay_at_salon', payment_status: 'unpaid', idempotency_key: body.p_idempotency_key, created_at: new Date().toISOString(),
      };
      state.bookings = [booking]; return send(booking);
    }
    if (path === '/rest/v1/rpc/reschedule_booking') {
      const old = state.bookings.find(entry => entry.id === body.p_booking_id);
      const booking = { ...old, staff_id: body.p_staff_id, starts_at: body.p_starts_at, ends_at: oneHourLater(body.p_starts_at) };
      state.bookings = [booking]; return send(booking);
    }
    if (path === '/rest/v1/rpc/cancel_booking') {
      const booking = { ...state.bookings.find(entry => entry.id === body.p_booking_id), status: 'cancelled' };
      state.bookings = [booking]; return send(booking);
    }
    if (path === '/rest/v1/rpc/complete_booking') {
      const old = state.bookings.find(entry => entry.id === body.p_booking_id);
      const booking = { ...old, status: 'completed', payment_status: body.p_paid ? 'paid' : old.payment_status };
      state.bookings = state.bookings.map(entry => entry.id === booking.id ? booking : entry);
      return send(booking);
    }
    if (path === '/rest/v1/rpc/create_salon') {
      const salon = { id: ids.draft, owner_id: ids.user, name: body.p_name, category: body.p_category, city: body.p_city, country: body.p_country, address: body.p_address, timezone: 'Europe/Athens', status: 'draft', cancellation_hours: 24, services: [], staff: [] };
      state.owners = [salon]; return send(salon);
    }
    if (path === '/rest/v1/services' && request.method() === 'POST') {
      const service = { ...body, id: '00000000-0000-4000-8000-000000000007' };
      state.owners[0].services.push(service); return send(service);
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return send({ message: `Unexpected test request: ${request.method()} ${path}` }, 400);
  });
  return state;
}

async function login(page, alreadyOpen = false) {
  if (!alreadyOpen) await page.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
  const panel = page.locator('.account-panel');
  await panel.getByLabel('Email', { exact: true }).fill(account.email);
  await panel.getByLabel(/^Κωδικός πρόσβασης/).fill('test-password-123');
  await panel.getByRole('button', { name: 'Σύνδεση', exact: true }).click();
  await expect(panel.getByRole('heading', { name: "Το προφίλ σας", exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Κλείσιμο λογαριασμού' }).click();
}

async function checkout(page, { fillContact = true } = {}) {
  const dialog = page.locator('.booking-live');
  await dialog.getByRole('button', { name: /Κούρεμα από κατάλογο/ }).click();
  await dialog.getByRole('button', { name: 'Συνέχεια', exact: true }).click();
  await dialog.getByRole('button', { name: /Επαγγελματίας Διακομιστή/ }).click();
  await dialog.getByLabel('Ημερομηνία ραντεβού').fill(futureDate());
  await dialog.getByRole('button', { name: '10:00 · Επαγγελματίας Διακομιστή', exact: true }).click();
  await dialog.getByRole('button', { name: 'Συνέχεια στην επιβεβαίωση' }).click();
  await expect(dialog.getByText('Πληρωμή στο κατάστημα', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ })).toBeDisabled();
  if (fillContact) await dialog.getByLabel('Αριθμός κινητού', { exact: true }).fill('+306900000000');
  await dialog.getByRole('checkbox').check();
  return dialog;
}

test('live catalog, signup and authenticated venue booking wait for server confirmation', async ({ page }) => {
  const state = await mockPlatform(page, { holdCreate: true });
  await page.goto('/');
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await expect(page.locator('.salon-card')).toContainText(publicSalon.name);
  await expect(page.locator('.salon-location')).toHaveText('Σόλωνος 10, Αθήνα, Ελλάδα');
  await expect(page.locator('.salon-grid')).not.toContainText('Atelier Hair Studio');
  await expect(page.locator('.rating')).toHaveCount(0);
  await expect(page.locator('.demo-note')).toHaveCount(0);
  await page.getByRole('button', { name: `Δείτε υπηρεσίες στο ${publicSalon.name}` }).click();
  await expect(page.locator('.booking-live')).toHaveCount(0);
  const panel = page.locator('.account-panel');
  await expect(panel.locator('.eneres-brand img')).toHaveAttribute('src', /eneres-flower\.png$/);
  await panel.getByRole('button', { name: 'Δημιουργία λογαριασμού', exact: true }).click();
  await panel.getByLabel('Όνομα', { exact: true }).fill('Ελένη Δοκιμή');
  await panel.getByLabel('Αριθμός κινητού', { exact: true }).fill('99000000');
  await panel.getByLabel('Email', { exact: true }).fill(account.email);
  await panel.getByLabel(/^Κωδικός πρόσβασης/).fill('test-password-123');
  await panel.locator('form').getByRole('button', { name: 'Δημιουργία λογαριασμού', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Ελέγξτε το email σας');
  expect(state.calls.find(call => call.path.endsWith('/auth/v1/signup')).body.data).toMatchObject({ mobile_phone: '+35799000000' });
  await expect(page.locator('.booking-live')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Έχω ήδη λογαριασμό' }).click();
  await login(page, true);
  const dialog = await checkout(page);
  await dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ }).click();
  await expect.poll(() => state.createPending).toBe(true);
  await expect(dialog.getByRole('heading', { name: /Το ραντεβού σας.*επιβεβαιώθηκε/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Καταχώριση κράτησης/ })).toBeDisabled();
  state.releaseCreate();
  await expect(dialog.getByRole('heading', { name: /Το ραντεβού σας.*επιβεβαιώθηκε/ })).toBeVisible();
  const create = state.calls.find(call => call.path.endsWith('/create_booking_with_contact'));
  expect(create.body).toMatchObject({ p_service_id: ids.service, p_staff_id: ids.staff, p_customer_name: 'Ελένη Δοκιμή' });
  expect(Object.keys(create.body).sort()).toEqual(['p_customer_name', 'p_customer_phone', 'p_idempotency_key', 'p_notes', 'p_service_id', 'p_staff_id', 'p_starts_at']);
  expect(create.body).toMatchObject({ p_customer_phone: '+306900000000', p_notes: '' });
  expect(create.authorization).toMatch(/^Bearer /);
  await dialog.getByRole('button', { name: 'Ολοκλήρωση', exact: true }).click();
  await page.locator('.desktop-nav').getByRole('button', { name: /Τα ραντεβού μου/ }).click();
  await expect(page.locator('.appointment-card')).toContainText('Επιβεβαιωμένο');
  expect(state.bookings[0]).toMatchObject({ payment_method: 'pay_at_salon', payment_status: 'unpaid' });
  expect(state.unexpected).toEqual([]);
});

test('date search shows only venues with real server availability for the selected day', async ({ page }) => {
  const unavailableDate = futureDate(8);
  const availableDate = futureDate(9);
  const state = await mockPlatform(page, { unavailableDates: [unavailableDate] });
  await page.goto('/');
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Πόλη ή περιοχή' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'Αθήνα', exact: true }).click();
  const date = page.getByLabel('Ημερομηνία ραντεβού');
  await date.fill(unavailableDate);
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expect.poll(() => state.calls.some(call => call.path.endsWith('/get_availability') && call.body.p_date === unavailableDate)).toBe(true);
  await expect(page.locator('.salon-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: "Δεν βρέθηκε ο ιδανικός συνδυασμός… ακόμα" })).toBeVisible();
  await date.fill(availableDate);
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expect.poll(() => state.calls.some(call => call.path.endsWith('/get_availability') && call.body.p_date === availableDate)).toBe(true);
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await expect(page.locator('.salon-card')).toContainText(publicSalon.name);
  state.failAvailability = true;
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.empty-state')).toHaveCount(0);
  state.failAvailability = false;
  await page.getByRole('button', { name: 'Αναζήτηση', exact: true }).click();
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(state.calls.filter(call => call.path.endsWith('/get_availability')).every(call => call.body.p_service_id === ids.service)).toBe(true);
  expect(state.calls.some(call => call.path.endsWith('/create_booking_with_contact'))).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('booking conflict refreshes availability and never displays false confirmation', async ({ page }) => {
  const state = await mockPlatform(page, { failCreate: true });
  await page.goto('/');
  await login(page);
  await page.getByRole('button', { name: `Δείτε υπηρεσίες στο ${publicSalon.name}` }).click();
  const dialog = await checkout(page);
  await dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('δεν είναι πλέον διαθέσιμη');
  await expect(dialog.getByRole('heading', { name: "Βρείτε τη δική σας στιγμή" })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /Το ραντεβού σας.*επιβεβαιώθηκε/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Συνέχεια στην επιβεβαίωση' })).toBeDisabled();
  expect(state.bookings).toEqual([]);
  expect(state.calls.filter(call => call.path.endsWith('/get_availability')).length).toBeGreaterThan(1);
  expect(state.unexpected).toEqual([]);
});

test('customer reschedule and cancellation use server RPC results', async ({ page }) => {
  const state = await mockPlatform(page);
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: `Δείτε υπηρεσίες στο ${publicSalon.name}` }).click();
  const dialog = await checkout(page);
  await dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ }).click();
  await dialog.getByRole('button', { name: 'Ολοκλήρωση', exact: true }).click();
  await page.locator('.desktop-nav').getByRole('button', { name: /Τα ραντεβού μου/ }).click();
  await page.getByRole('button', { name: 'Αλλαγή ώρας', exact: true }).click();
  const change = page.getByRole('dialog', { name: 'Αλλαγή ώρας ραντεβού' });
  await change.getByRole('button', { name: /12:00.*Επαγγελματίας Διακομιστή/ }).click();
  await change.getByRole('button', { name: 'Επιβεβαίωση νέας ώρας' }).click();
  await expect(change).toHaveCount(0);
  await expect(page.locator('.appointment-card')).toContainText('12:00');
  expect(state.calls.find(call => call.path.endsWith('/reschedule_booking')).body).toMatchObject({ p_booking_id: ids.booking, p_staff_id: ids.staff });
  await page.getByRole('button', { name: 'Ακύρωση ραντεβού', exact: true }).click();
  const cancelDialog = page.getByRole('dialog', { name: 'Να ακυρώσουμε το ραντεβού;', exact: true });
  const brandOffset = await cancelDialog.evaluate(element => { const dialog = element.getBoundingClientRect(); const brand = element.querySelector('.dialog-brand').getBoundingClientRect(); return Math.abs(brand.x + brand.width / 2 - dialog.x - dialog.width / 2); });
  expect(brandOffset).toBeLessThanOrEqual(1);
  await cancelDialog.getByRole('button', { name: 'Ναι, ακύρωση' }).click();
  await expect(page.locator('.appointment-card')).toContainText('Ακυρωμένο');
  await expect(page.getByRole('button', { name: 'Αλλαγή ώρας', exact: true })).toHaveCount(0);
  expect(state.calls.find(call => call.path.endsWith('/cancel_booking')).body).toEqual({ p_booking_id: ids.booking });
  expect(state.unexpected).toEqual([]);
});

test('business creates a server-side draft and clears private forms when another tab signs out', async ({ page }) => {
  const state = await mockPlatform(page);
  await page.goto('/'); await login(page);
  await page.locator('.header-actions').getByRole('button', { name: /Για επαγγελματίες/ }).click();
  await page.getByLabel('Όνομα επιχείρησης').fill('Νέα Επιχείρηση Ιδιοκτήτη');
  await page.getByRole('combobox', { name: 'Πόλη', exact: true }).selectOption('Αθήνα');
  await page.getByLabel('Διεύθυνση', { exact: true }).fill('Σόλωνος 10');
  await page.getByRole('button', { name: 'Δημιουργία πρόχειρης επιχείρησης' }).click();
  await expect(page.locator('.lb-sidebar')).toContainText('Πρόχειρο');
  await expect(page.getByRole('button', { name: 'Υποβολή για έλεγχο' })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Διαχείριση επιχείρησης' }).getByRole('button', { name: 'Ημερολόγιο', exact: true }).click();
  await expect(page.getByText("Δεν υπάρχουν ραντεβού για αυτή την ημέρα", { exact: true })).toBeVisible();
  await expect(page.locator('.biz-appointment,.lb-booking-row')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Διαχείριση επιχείρησης' }).getByRole('button', { name: 'Υπηρεσίες', exact: true }).click();
  await page.getByRole('button', { name: 'Νέα υπηρεσία', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Νέα υπηρεσία' });
  await form.getByLabel('Όνομα υπηρεσίας').fill('Υπηρεσία Ιδιοκτήτη');
  await form.getByLabel('Τιμή (€)').fill('28');
  await form.getByRole('button', { name: 'Αποθήκευση υπηρεσίας' }).click();
  await expect(page.locator('.lb-record-list')).toContainText('Υπηρεσία Ιδιοκτήτη');
  expect(state.calls.find(call => call.path.endsWith('/create_salon')).body.p_name).toBe('Νέα Επιχείρηση Ιδιοκτήτη');
  expect(state.owners[0]).toMatchObject({ owner_id: ids.user, status: 'draft' });
  expect(state.owners[0].services[0]).toMatchObject({ price_cents: 2800, salon_id: ids.draft });
  expect(state.unexpected).toEqual([]);

  // A real Auth broadcast from another tab must close owner-only dialogs too.
  await page.getByRole('button', { name: 'Νέα υπηρεσία', exact: true }).click();
  await page.getByRole('dialog', { name: 'Νέα υπηρεσία' }).getByLabel('Όνομα υπηρεσίας').fill('Ιδιωτική Υπηρεσία Ιδιοκτήτη');
  const otherTab = await page.context().newPage();
  try {
    await mockPlatform(otherTab);
    await otherTab.goto('/');
    await otherTab.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
    const accountPanel = otherTab.locator('.account-panel');
    await expect(accountPanel.getByRole('heading', { name: "Το προφίλ σας", exact: true })).toBeVisible();
    await accountPanel.getByRole('button', { name: 'Αποσύνδεση', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Νέα υπηρεσία' })).toHaveCount(0);
    await expect(page.locator('.lb-sidebar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Σύνδεση / Δημιουργία λογαριασμού' })).toBeVisible();
  } finally { await otherTab.close(); }
});

test('invalid platform configuration fails closed instead of falling back to example businesses', async ({ page }) => {
  const requests = [];
  await page.route('**/platform-config.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.MERAKI_CONFIG=${JSON.stringify({ supabaseUrl: 'http://invalid-backend.example', supabasePublishableKey: 'sb_secret_forbidden_in_browser' })};` }));
  await page.route('https://*.supabase.co/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Η σύνδεση της υπηρεσίας χρειάζεται έλεγχο" })).toBeVisible();
  await expect(page.locator('.salon-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Κλείστε ραντεβού/ })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('owner records venue payment for a completed unpaid appointment and sees refreshed paid status', async ({ page }) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
  const startsAt = localInstant(today, 10);
  const state = await mockPlatform(page, {
    owners: [{ ...publicSalon, owner_id: ids.user }],
    bookings: [{
      id: ids.booking, salon_id: ids.salon, service_id: ids.service, staff_id: ids.staff,
      customer_id: ids.user, customer_name: 'Πελάτης Με Ολοκληρωμένο Ραντεβού', customer_email: 'customer@example.com',
      service_name: 'Κούρεμα από κατάλογο', price_cents: 3500,
      starts_at: startsAt, ends_at: oneHourLater(startsAt), created_at: startsAt,
      status: 'completed', payment_method: 'pay_at_salon', payment_status: 'unpaid',
    }],
  });
  await page.goto('/'); await login(page);
  await page.locator('.header-actions').getByRole('button', { name: /Για επαγγελματίες/ }).click();
  const row = page.locator('.lb-booking-row');
  await expect(row).toContainText('Ολοκληρωμένο');
  await row.click();
  const detail = page.getByRole('dialog', { name: 'Λεπτομέρειες ραντεβού' });
  await expect(detail).toContainText('Ανεξόφλητο');
  await expect(detail).toContainText("Δεν γίνεται ηλεκτρονική χρέωση");
  await detail.getByRole('button', { name: 'Καταχώριση εξόφλησης στο κατάστημα', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(row).toContainText('πληρωμένο');
  const payments = state.calls.filter(call => call.path.endsWith('/complete_booking'));
  expect(payments).toHaveLength(1);
  expect(payments[0].body).toEqual({ p_booking_id: ids.booking, p_paid: true });
  expect(payments[0].authorization).toMatch(/^Bearer /);
  expect(state.bookings[0]).toMatchObject({ status: 'completed', payment_status: 'paid' });
  await row.click();
  await expect(page.getByRole('dialog', { name: 'Λεπτομέρειες ραντεβού' })).toContainText('Εξοφλημένο');
  await expect(page.getByRole('button', { name: 'Καταχώριση εξόφλησης στο κατάστημα', exact: true })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test('an offline reservation removes a selected consumer slot when the checkout regains focus', async ({ page }) => {
  const state = await mockPlatform(page);
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: `Δείτε υπηρεσίες στο ${publicSalon.name}` }).click();
  const dialog = await checkout(page);
  await expect(dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ })).toBeEnabled();
  const checksBefore = state.calls.filter(call => call.path.endsWith('/get_availability')).length;
  // The authoritative availability response changes after an offline reservation.
  // No customer-side booking is submitted by this scenario.
  state.unavailableDates = [futureDate()];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => state.calls.filter(call => call.path.endsWith('/get_availability')).length).toBeGreaterThan(checksBefore);
  await expect(dialog.getByRole('heading', { name: /^Βρείτε τη δική σας στιγμή\.?$/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Συνέχεια στην επιβεβαίωση', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ })).toHaveCount(0);
  expect(state.calls.some(call => call.path.endsWith('/create_booking_with_contact'))).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('consumer must provide a mobile number and customer notes reach the server booking', async ({ page }) => {
  const state = await mockPlatform(page);
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: `Δείτε υπηρεσίες στο ${publicSalon.name}` }).click();
  const dialog = await checkout(page, { fillContact: false });
  const confirm = dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ });
  await expect(dialog.getByLabel('Αριθμός κινητού', { exact: true })).toHaveAttribute('required', '');
  await confirm.click();
  expect(state.calls.some(call => call.path.endsWith('/create_booking_with_contact'))).toBe(false);
  await dialog.getByLabel('Αριθμός κινητού', { exact: true }).fill('+30123');
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('έγκυρο κινητό');
  expect(state.calls.some(call => call.path.endsWith('/create_booking_with_contact'))).toBe(false);
  await dialog.getByLabel('Αριθμός κινητού', { exact: true }).fill('+306900000000');
  await dialog.getByLabel('Σημειώσεις για την επιχείρηση (προαιρετικό)', { exact: true }).fill('Παρακαλώ καλέστε με πριν το ραντεβού');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.getByRole('heading', { name: /Το ραντεβού σας.*επιβεβαιώθηκε/ })).toBeVisible();
  expect(state.calls.find(call => call.path.endsWith('/create_booking_with_contact')).body).toMatchObject({
    p_customer_phone: '+306900000000', p_notes: 'Παρακαλώ καλέστε με πριν το ραντεβού',
  });
  expect(state.bookings[0]).toMatchObject({ customer_phone: '+306900000000', notes: 'Παρακαλώ καλέστε με πριν το ραντεβού', booking_source: 'online' });
  expect(state.unexpected).toEqual([]);
});

test('signup requires a valid mobile number and sends the chosen country prefix to Auth', async ({ page }) => {
  const state = await mockPlatform(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
  const panel = page.locator('.account-panel');
  await panel.getByRole('button', { name: 'Δημιουργία λογαριασμού', exact: true }).click();
  await panel.getByLabel('Όνομα', { exact: true }).fill('Νέος Πελάτης');
  await panel.getByLabel('Email', { exact: true }).fill('new-user@example.test');
  await panel.getByLabel(/^Κωδικός πρόσβασης/).fill('isolated-password-123');
  await expect(panel.getByRole('combobox', { name: 'Κωδικός χώρας', exact: true })).toHaveValue('CY');
  await expect(panel.getByLabel('Αριθμός κινητού', { exact: true })).toHaveAttribute('required', '');
  const submit = panel.locator('form').getByRole('button', { name: 'Δημιουργία λογαριασμού', exact: true });
  await submit.click();
  expect(state.calls.some(call => call.path.endsWith('/auth/v1/signup'))).toBe(false);
  await panel.getByLabel('Αριθμός κινητού', { exact: true }).fill('123');
  await submit.click();
  await expect(panel.getByRole('alert')).toContainText('έγκυρο αριθμό κινητού');
  expect(state.calls.some(call => call.path.endsWith('/auth/v1/signup'))).toBe(false);
  await panel.getByRole('combobox', { name: 'Κωδικός χώρας', exact: true }).selectOption('GR');
  await panel.getByLabel('Αριθμός κινητού', { exact: true }).fill('6900000000');
  await submit.click();
  await expect(panel.getByRole('status')).toContainText('Ελέγξτε το email σας');
  expect(state.calls.find(call => call.path.endsWith('/auth/v1/signup')).body.data).toEqual({ full_name: 'Νέος Πελάτης', mobile_phone: '+306900000000' });
  expect(state.unexpected).toEqual([]);
});

test('a saved mobile profile persists a changed country code and autofills the booking contact field', async ({ page }) => {
  const state = await mockPlatform(page, { profile: { user_id: ids.user, full_name: 'Ελένη Δοκιμή', mobile_phone: '+35799000000' } });
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
  const panel = page.locator('.account-panel');
  await expect(panel.getByRole('combobox', { name: 'Κωδικός χώρας', exact: true })).toHaveValue('CY');
  await expect(panel.getByLabel('Αριθμός κινητού', { exact: true })).toHaveValue('99000000');
  await panel.getByRole('combobox', { name: 'Κωδικός χώρας', exact: true }).selectOption('GR');
  await panel.getByLabel('Αριθμός κινητού', { exact: true }).fill('6900000000');
  await panel.getByRole('button', { name: 'Αποθήκευση προφίλ', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Το προφίλ σας ενημερώθηκε');
  expect(state.calls.find(call => call.path === '/rest/v1/profiles' && call.method === 'POST').body).toMatchObject({ mobile_phone: '+306900000000' });
  await panel.getByRole('button', { name: 'Κλείσιμο λογαριασμού', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: `Δείτε υπηρεσίες στο ${publicSalon.name}` }).click();
  const dialog = await checkout(page, { fillContact: false });
  await expect(dialog.getByRole('combobox', { name: 'Κωδικός χώρας', exact: true })).toHaveValue('GR');
  await expect(dialog.getByLabel('Αριθμός κινητού', { exact: true })).toHaveValue('6900000000');
  await dialog.getByRole('button', { name: /Επιβεβαίωση ραντεβού/ }).click();
  await expect(dialog.getByRole('heading', { name: /Το ραντεβού σας.*επιβεβαιώθηκε/ })).toBeVisible();
  expect(state.calls.find(call => call.path.endsWith('/create_booking_with_contact')).body).toMatchObject({ p_customer_phone: '+306900000000' });
  expect(state.unexpected).toEqual([]);
});

test('private booking contact details close when another browser tab signs the account out', async ({ page }) => {
  await mockPlatform(page);
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: `Δείτε υπηρεσίες στο ${publicSalon.name}` }).click();
  const dialog = await checkout(page);
  await dialog.getByLabel('Σημειώσεις για την επιχείρηση (προαιρετικό)', { exact: true }).fill('Ιδιωτική σημείωση του πρώτου λογαριασμού');
  const otherTab = await page.context().newPage();
  try {
    await mockPlatform(otherTab);
    await otherTab.goto('/');
    await otherTab.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
    const panel = otherTab.locator('.account-panel');
    await expect(panel.getByRole('heading', { name: 'Το προφίλ σας', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Αποσύνδεση', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Ιδιωτική σημείωση του πρώτου λογαριασμού', { exact: true })).toHaveCount(0);
  } finally { await otherTab.close(); }
});
