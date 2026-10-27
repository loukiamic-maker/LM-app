import { test, expect } from '@playwright/test';

// These sessions, codes and recipients exist only in intercepted HTTP fixtures.
// No SMS or email provider is contacted by these tests.
const HOST = 'https://eneres-phone-auth-test.supabase.co';
const ids = { user: '97000000-0000-4000-8000-000000000001', salon: '97000000-0000-4000-8000-000000000002', service: '97000000-0000-4000-8000-000000000003', staff: '97000000-0000-4000-8000-000000000004' };
const stamp = '2026-01-01T00:00:00Z';
const baseUser = { id: ids.user, aud: 'authenticated', role: 'authenticated', email: '', email_confirmed_at: null, phone: '', phone_confirmed_at: null, user_metadata: {}, app_metadata: { provider: 'phone', providers: ['phone'] }, identities: [], created_at: stamp };
const venue = { id: ids.salon, owner_id: 'another-owner', name: 'Χώρος SMS', category: 'hair', city: 'Αθήνα', country: 'Ελλάδα', address: 'Οδός Δοκιμής 1', status: 'published', timezone: 'Europe/Athens', cancellation_hours: 24,
  services: [{ id: ids.service, salon_id: ids.salon, name: 'Κούρεμα SMS', duration_minutes: 60, price_cents: 3500, active: true }], staff: [{ id: ids.staff, salon_id: ids.salon, name: 'Επαγγελματίας SMS', active: true }] };
const jwtSession = user => {
  const now = Math.floor(Date.now() / 1000);
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.fixture`;
  return { access_token: token, refresh_token: 'phone-fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
};
async function mockPhoneAuth(page, options = {}) {
  await page.addInitScript(() => localStorage.setItem('eneres-language', 'el'));
  const state = { calls: [], unexpected: [], user: null, profile: { user_id: ids.user, full_name: '', mobile_phone: '' }, signupData: {}, providerError: false, requirementsError: false, legacy: false, ...options };
  await page.route('**/platform-config.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.MERAKI_CONFIG=${JSON.stringify({ supabaseUrl: HOST, supabasePublishableKey: 'sb_publishable_phone_fixture' })};` }));
  await page.route(`${HOST}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    state.calls.push({ method: request.method(), path, body });
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE' } });
    if (path === '/rest/v1/rpc/get_auth_requirements') return state.requirementsError ? send({ code: 'XX000', message: 'Temporary failure' }, 503) : send({ require_verified_phone: true });
    if (path === '/auth/v1/otp') {
      if (state.providerError) return send({ code: 'sms_provider_disabled', msg: 'SMS provider disabled' }, 422);
      state.signupData = body.data || {};
      return send({ message_id: 'isolated-sms' });
    }
    if (path === '/auth/v1/token') {
      state.user = { ...structuredClone(baseUser), email: 'legacy@example.test', email_confirmed_at: stamp, user_metadata: { full_name: 'Υπάρχων Πελάτης' }, app_metadata: { provider: 'email', providers: ['email'] } };
      state.profile = { user_id: ids.user, full_name: 'Υπάρχων Πελάτης', mobile_phone: '+35799123456' };
      return send(jwtSession(state.user));
    }
    if (path === '/auth/v1/verify') {
      if (body.token !== '123456') return send({ code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403);
      if (body.type === 'sms') {
        state.user = { ...structuredClone(baseUser), phone: body.phone.replace(/^\+/, ''), phone_confirmed_at: stamp, user_metadata: { ...state.signupData }, ...(state.knownPhone ? { email: 'verified@example.test', email_confirmed_at: stamp } : {}) };
        state.profile = { user_id: ids.user, full_name: state.signupData.full_name || 'Πελάτης SMS', mobile_phone: body.phone };
      } else {
        state.user = { ...state.user, phone: body.phone.replace(/^\+/, ''), phone_confirmed_at: stamp };
        state.profile.mobile_phone = body.phone;
      }
      return send(jwtSession(state.user));
    }
    if (path === '/auth/v1/user') {
      if (request.method() === 'PUT') {
        if (body.phone) state.pendingPhone = body.phone;
        if (body.data) Object.assign(state.user.user_metadata, body.data);
        if (body.email) { state.user.new_email = body.email; state.user.email_change_sent_at = stamp; }
      }
      return send(state.user);
    }
    if (path === '/auth/v1/resend') return send({});
    if (path === '/auth/v1/logout') { state.user = null; return send({}); }
    if (path === '/rest/v1/profiles') {
      if (request.method() === 'GET') return send([state.profile]);
      Object.assign(state.profile, body); return send(null);
    }
    if (path === '/rest/v1/salons') return send([venue]);
    if (path === '/rest/v1/bookings' || path === '/rest/v1/staff_hours' || path === '/rest/v1/staff_time_off') return send([]);
    if (path === '/rest/v1/rpc/get_availability') {
      const starts = new Date(`${body.p_date}T10:00:00+02:00`).toISOString();
      return send([{ staff_id: ids.staff, staff_name: 'Επαγγελματίας SMS', starts_at: starts, ends_at: new Date(Date.parse(starts) + 3600000).toISOString(), local_time: '10:00' }]);
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return send({ message: `Unexpected isolated phone request: ${path}` }, 400);
  });
  return state;
}
async function openAccount(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
  const panel = page.locator('.account-panel');
  await expect(panel.getByRole('button', { name: 'Αποστολή κωδικού SMS', exact: true })).toBeVisible();
  return panel;
}
async function enterPhone(panel, number = '99123456') {
  await panel.getByRole('combobox', { name: 'Κωδικός χώρας', exact: true }).selectOption('CY');
  await panel.getByLabel('Αριθμός κινητού', { exact: true }).fill(number);
}
async function verifySms(panel, code = '123456') {
  await panel.getByLabel('Κωδικός SMS', { exact: true }).fill(code);
  await panel.getByRole('button', { name: 'Επιβεβαίωση κωδικού', exact: true }).click();
}

test('phone signup verifies SMS before adding an email and requires email confirmation before booking', async ({ page }) => {
  const state = await mockPhoneAuth(page);
  const panel = await openAccount(page);
  await panel.getByRole('button', { name: 'Δημιουργία λογαριασμού', exact: true }).click();
  await expect(panel.getByLabel('Όνομα', { exact: true })).toHaveAttribute('required', '');
  await panel.getByLabel('Όνομα', { exact: true }).fill('Νέα Πελάτισσα');
  await enterPhone(panel);
  await panel.getByRole('button', { name: 'Αποστολή κωδικού SMS', exact: true }).click();
  const otp = state.calls.find(call => call.path === '/auth/v1/otp');
  expect(otp.body).toMatchObject({ phone: '+35799123456', create_user: true, data: { full_name: 'Νέα Πελάτισσα', mobile_phone: '+35799123456' } });
  await expect(panel.getByRole('heading', { name: 'Επιβεβαίωση κινητού', exact: true })).toBeVisible();
  await verifySms(panel, '000000');
  await expect(panel.getByRole('alert')).toContainText('δεν είναι σωστός ή έχει λήξει');
  expect(state.user).toBeNull();
  await verifySms(panel);
  await expect(panel.getByRole('heading', { name: 'Το προφίλ σας', exact: true })).toBeVisible();
  await expect(panel.getByText('Το κινητό σας έχει επιβεβαιωθεί με SMS', { exact: true })).toBeVisible();
  await panel.locator('.account-email-form').getByLabel('Email', { exact: true }).fill('client@example.test');
  await panel.getByRole('button', { name: 'Αποστολή επιβεβαίωσης email', exact: true }).click();
  expect(state.calls.find(call => call.path === '/auth/v1/user' && call.method === 'PUT' && call.body.email).body).toEqual({ email: 'client@example.test', code_challenge: expect.any(String), code_challenge_method: 's256' });
  await panel.getByRole('button', { name: 'Κλείσιμο λογαριασμού', exact: true }).click();
  await page.getByRole('button', { name: 'Δείτε υπηρεσίες στο Χώρος SMS', exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(page.locator('.booking-live')).toHaveCount(0);
  expect(state.calls.some(call => call.path.endsWith('/create_booking_with_contact'))).toBe(false);
  state.user.email = 'client@example.test'; state.user.email_confirmed_at = stamp; delete state.user.new_email;
  await panel.getByRole('button', { name: 'Έχω επιβεβαιώσει το email', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Το email σας έχει επιβεβαιωθεί');
  await panel.getByRole('button', { name: 'Κλείσιμο λογαριασμού', exact: true }).click();
  await expect(page.locator('.booking-live')).toBeVisible();
  expect(state.profile).toMatchObject({ full_name: 'Νέα Πελάτισσα', mobile_phone: '+35799123456' });
  expect(state.unexpected).toEqual([]);
});

test('phone login cannot create an unknown account and handles SMS provider failures without fake verification', async ({ page }) => {
  const state = await mockPhoneAuth(page, { providerError: true });
  const panel = await openAccount(page);
  await expect(panel.getByLabel('Κωδικός πρόσβασης', { exact: true })).toHaveCount(0);
  await enterPhone(panel);
  await panel.getByRole('button', { name: 'Αποστολή κωδικού SMS', exact: true }).click();
  expect(state.calls.find(call => call.path === '/auth/v1/otp').body).toMatchObject({ phone: '+35799123456', create_user: false });
  await expect(panel.getByRole('alert')).toContainText('Η αποστολή SMS δεν είναι διαθέσιμη');
  await expect(panel.getByLabel('Κωδικός SMS', { exact: true })).toHaveCount(0);
  expect(state.user).toBeNull();
  expect(state.calls.some(call => call.path === '/rest/v1/profiles' && call.method !== 'GET')).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('email fallback directs new registrations to phone verification instead of creating an email-only account', async ({ page }) => {
  const state = await mockPhoneAuth(page);
  const panel = await openAccount(page);
  await panel.getByRole('button', { name: 'Σύνδεση με email για υπάρχοντα λογαριασμό', exact: true }).click();
  await expect(panel.getByLabel('Email', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Δημιουργία λογαριασμού με κινητό', exact: true }).click();
  await expect(panel.getByLabel('Email', { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('Κωδικός πρόσβασης', { exact: true })).toHaveCount(0);
  await panel.getByLabel('Όνομα', { exact: true }).fill('Νέα Πελάτισσα');
  await enterPhone(panel);
  await panel.getByRole('button', { name: 'Αποστολή κωδικού SMS', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Επιβεβαίωση κινητού', exact: true })).toBeVisible();
  expect(state.calls.find(call => call.path === '/auth/v1/otp').body).toMatchObject({ create_user: true });
  expect(state.calls.some(call => call.path === '/auth/v1/signup')).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('existing email account links or changes a phone only after the phone-change SMS code is verified', async ({ page }) => {
  const state = await mockPhoneAuth(page);
  const panel = await openAccount(page);
  await panel.getByRole('button', { name: 'Σύνδεση με email για υπάρχοντα λογαριασμό', exact: true }).click();
  await panel.getByLabel('Email', { exact: true }).fill('legacy@example.test');
  await panel.getByLabel('Κωδικός πρόσβασης', { exact: true }).fill('isolated-password');
  await panel.getByRole('button', { name: 'Σύνδεση', exact: true }).click();
  await expect(panel.getByText('Επιβεβαιώστε το κινητό σας με SMS για να κάνετε κράτηση', { exact: true })).toBeVisible();
  await panel.getByRole('combobox', { name: 'Κωδικός χώρας', exact: true }).selectOption('GR');
  await panel.getByLabel('Αριθμός κινητού', { exact: true }).fill('6900000000');
  await panel.getByRole('button', { name: 'Επιβεβαίωση κινητού με SMS', exact: true }).click();
  await expect(panel.getByLabel('Κωδικός SMS', { exact: true })).toBeVisible();
  expect(state.calls.find(call => call.path === '/auth/v1/user' && call.method === 'PUT').body).toMatchObject({ phone: '+306900000000', data: { full_name: 'Υπάρχων Πελάτης' } });
  expect(state.profile.mobile_phone).toBe('+35799123456');
  expect(state.calls.some(call => call.path === '/rest/v1/profiles' && call.method !== 'GET')).toBe(false);
  await verifySms(panel, '000000');
  expect(state.profile.mobile_phone).toBe('+35799123456');
  await verifySms(panel);
  expect(state.calls.find(call => call.path === '/auth/v1/verify' && call.body.token === '123456').body).toMatchObject({ phone: '+306900000000', token: '123456', type: 'phone_change' });
  await expect(panel.getByText('Το κινητό σας έχει επιβεβαιωθεί με SMS', { exact: true })).toBeVisible();
  expect(state.profile.mobile_phone).toBe('+306900000000');
  expect(state.profile.full_name).toBe('Υπάρχων Πελάτης');
  expect(state.user.email).toBe('legacy@example.test');
  expect(state.user.email_confirmed_at).toBe(stamp);
  expect(state.unexpected).toEqual([]);
});

test('a failed requirements lookup does not silently enable unverified booking or send an SMS', async ({ page }) => {
  const state = await mockPhoneAuth(page, { requirementsError: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Το προφίλ μου', exact: true }).click();
  const panel = page.locator('.account-panel');
  await expect(panel.getByRole('alert')).toContainText('ρυθμίσεις ασφαλούς σύνδεσης');
  const send = panel.getByRole('button', { name: 'Αποστολή κωδικού SMS', exact: true });
  await expect(send).toBeDisabled();
  expect(state.calls.some(call => call.path === '/auth/v1/otp')).toBe(false);
  state.requirementsError = false;
  await panel.getByRole('button', { name: 'Δοκιμή ξανά', exact: true }).click();
  await expect(send).toBeEnabled();
  expect(state.unexpected).toEqual([]);
});
