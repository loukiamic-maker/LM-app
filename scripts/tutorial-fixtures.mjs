// Isolated screen-recording fixtures. Every backend request is intercepted;
// these example accounts/bookings never reach the hosted Supabase project.
export const tutorialHost = 'https://eneres-guide-demo.supabase.co';
export const demoIds = {
  owner: '76000000-0000-4000-8000-000000000001', client: '76000000-0000-4000-8000-000000000002',
  salon: '76000000-0000-4000-8000-000000000003', staff: '76000000-0000-4000-8000-000000000004',
  service: '76000000-0000-4000-8000-000000000005',
};
export const demoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
export const demoFuture = (count = 2) => { const date = new Date(`${demoToday()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); };
export function demoInstant(date, hour, minute = 0) {
  const noon = new Date(`${date}T12:00:00Z`);
  const offset = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: 'numeric', hourCycle: 'h23' }).format(noon)) - 12;
  return new Date(`${date}T${String(hour - offset).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`).toISOString();
}

export function demoBooking({ name = 'Μαρία Παράδειγμα', hour = 10, minute = 0, date = demoToday(), source = 'online', id = crypto.randomUUID(), language = 'el' } = {}) {
  const starts = demoInstant(date, hour, minute);
  return {
    id, salon_id: demoIds.salon, service_id: demoIds.service, staff_id: demoIds.staff, customer_id: source === 'online' ? demoIds.client : null,
    starts_at: starts, ends_at: new Date(Date.parse(starts) + 3600000).toISOString(), customer_name: language === 'en' && name === 'Μαρία Παράδειγμα' ? 'Maria Example' : name,
    customer_email: 'client@example.test', customer_phone: '+30 000 000 0000', notes: language === 'en' ? 'Example customer note' : 'Ενδεικτική σημείωση πελάτη',
    service_name: language === 'en' ? 'Haircut & styling' : 'Κούρεμα & χτένισμα', salon_name: language === 'en' ? 'Studio Example' : 'Studio Παράδειγμα', staff_name: language === 'en' ? 'Elena Example' : 'Ελένη Παράδειγμα',
    country: 'Ελλάδα', timezone: 'Europe/Athens', cancellation_hours: 24, price_cents: 3500, status: 'confirmed',
    payment_method: 'pay_at_salon', payment_status: 'unpaid', booking_source: source, cancellation_note: '', created_at: new Date().toISOString(),
  };
}
export function demoAlert(booking) {
  return { id: crypto.randomUUID(), booking_id: booking.id, salon_id: booking.salon_id, status: 'new', booking_status: booking.status,
    ...Object.fromEntries(['customer_name', 'customer_email', 'customer_phone', 'notes', 'starts_at', 'ends_at', 'service_name', 'staff_name', 'timezone', 'price_cents', 'cancellation_note', 'created_at'].map(key => [key, booking[key]])),
    noted_at: null, cancelled_at: null, booking };
}

export async function installTutorialFixtures(context, audience, origin, language = 'el') {
  await context.addInitScript(language => localStorage.setItem('eneres-language', language), language);
  const userId = audience === 'business' ? demoIds.owner : demoIds.client;
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: audience === 'business' ? 'owner@example.test' : 'client@example.test',
    email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: language === 'en' ? (audience === 'business' ? 'Elena Example' : 'Maria Example') : (audience === 'business' ? 'Ελένη Παράδειγμα' : 'Μαρία Παράδειγμα') }, identities: [], created_at: '2026-01-01T00:00:00Z' };
  const salon = { id: demoIds.salon, owner_id: demoIds.owner, name: language === 'en' ? 'Studio Example' : 'Studio Παράδειγμα', category: 'hair', city: 'Αθήνα', country: 'Ελλάδα', address: language === 'en' ? '10 Example Street' : 'Οδός Παραδείγματος 10',
    timezone: 'Europe/Athens', status: 'published', cancellation_hours: 24, description: language === 'en' ? 'An example salon for this walkthrough' : 'Ενδεικτικός χώρος για την παρουσίαση των λειτουργιών', image_url: `${origin}/tutorials/demo-salon.jpg`,
    services: [{ id: demoIds.service, salon_id: demoIds.salon, name: language === 'en' ? 'Haircut & styling' : 'Κούρεμα & χτένισμα', duration_minutes: 60, price_cents: 3500, active: true }],
    staff: [{ id: demoIds.staff, salon_id: demoIds.salon, name: language === 'en' ? 'Elena Example' : 'Ελένη Παράδειγμα', active: true }] };
  const state = { user, salon, bookings: audience === 'business' ? [demoBooking({ language }), demoBooking({ name: language === 'en' ? 'Nikos Example' : 'Νίκος Παράδειγμα', hour: 13, minute: 30, source: 'offline', language })] : [], alerts: [], unexpected: [], writes: [] };
  await context.route('**/platform-config*.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.MERAKI_CONFIG=${JSON.stringify({ supabaseUrl: tutorialHost, supabasePublishableKey: 'sb_publishable_tutorial_fixture' })};` }));
  await context.route(`${tutorialHost}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let body; try { body = request.postDataJSON(); } catch { body = null; }
    const send = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' }, body: JSON.stringify(value) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' } });
    if (request.method() !== 'GET') state.writes.push(path);
    if (path === '/auth/v1/token') {
      const now = Math.floor(Date.now() / 1000), token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 7200 })).toString('base64url')}.demo`;
      return send({ access_token: token, refresh_token: 'example-refresh', token_type: 'bearer', expires_in: 7200, expires_at: now + 7200, user });
    }
    if (path === '/rest/v1/rpc/get_auth_requirements') return send({ require_verified_phone: false });
    if (path === '/auth/v1/user') return send(user);
    if (path === '/auth/v1/logout') return send({});
    if (path === '/rest/v1/profiles') return send([{ user_id: userId, full_name: user.user_metadata.full_name, mobile_phone: '+300000000000' }]);
    if (path === '/rest/v1/salons') {
      if (request.method() === 'PATCH') { Object.assign(salon, body); return send(salon); }
      if (url.searchParams.has('id')) return send(salon);
      if (url.searchParams.has('owner_id')) return send(audience === 'business' ? [salon] : []);
      return send([salon]);
    }
    if (path === '/rest/v1/staff') return send(salon.staff[0]);
    if (path === '/rest/v1/staff_hours') return send(Array.from({ length: 7 }, (_, weekday) => ({ id: `hours-${weekday}`, staff_id: demoIds.staff, weekday, opens_at: '09:00:00', closes_at: '18:00:00' })));
    if (path === '/rest/v1/staff_time_off') return send([]);
    if (path === '/rest/v1/bookings') {
      const start = url.searchParams.getAll('starts_at').find(value => value.startsWith('gte.'))?.slice(4);
      const end = url.searchParams.getAll('starts_at').find(value => value.startsWith('lt.'))?.slice(3);
      return send(state.bookings.filter(entry => (!start || entry.starts_at >= start) && (!end || entry.starts_at < end)));
    }
    if (path === '/rest/v1/rpc/get_availability') return send([10, 11, 14, 16].map(hour => {
      const starts = demoInstant(body.p_date, hour); return { staff_id: demoIds.staff, staff_name: salon.staff[0].name, starts_at: starts, ends_at: new Date(Date.parse(starts) + 3600000).toISOString(), local_time: `${hour}:00` };
    }).filter(slot => !state.bookings.some(entry => entry.status === 'confirmed' && entry.staff_id === slot.staff_id && entry.starts_at < slot.ends_at && entry.ends_at > slot.starts_at)));
    if (path === '/rest/v1/rpc/create_booking_with_contact' || path === '/rest/v1/rpc/create_booking') {
      const entry = { ...demoBooking({ date: body.p_starts_at.slice(0, 10), language }), starts_at: body.p_starts_at, ends_at: new Date(Date.parse(body.p_starts_at) + 3600000).toISOString(), customer_name: body.p_customer_name, customer_phone: body.p_customer_phone || '+30 000 000 0000', notes: body.p_notes || '', idempotency_key: body.p_idempotency_key };
      state.bookings.push(entry); state.alerts.unshift(demoAlert(entry)); return send(entry);
    }
    if (path === '/rest/v1/rpc/cancel_booking' || path === '/rest/v1/rpc/cancel_booking_with_note') {
      const entry = state.bookings.find(booking => booking.id === body.p_booking_id); entry.status = 'cancelled'; entry.cancellation_note = body.p_reason || '';
      state.alerts.forEach(alert => { if (alert.booking_id === entry.id) Object.assign(alert, { status: 'cancelled', booking_status: 'cancelled', cancellation_note: entry.cancellation_note }); });
      return send(entry);
    }
    if (path === '/rest/v1/rpc/create_manual_booking') {
      const entry = { ...demoBooking({ source: 'offline', language }), starts_at: body.p_starts_at, ends_at: new Date(Date.parse(body.p_starts_at) + body.p_duration_minutes * 60000).toISOString(), customer_name: body.p_customer_name, customer_phone: body.p_customer_phone, customer_email: body.p_customer_email || '', notes: body.p_notes || '', price_cents: body.p_price_cents, idempotency_key: body.p_idempotency_key };
      state.bookings.push(entry); return send(entry);
    }
    if (path === '/rest/v1/rpc/list_business_booking_alerts') return send(state.alerts.slice(body.p_offset || 0, (body.p_offset || 0) + (body.p_limit || 100)).map(alert => ({ ...alert, salon_unread_count: state.alerts.filter(entry => entry.status === 'new').length })));
    if (path === '/rest/v1/rpc/acknowledge_business_booking') { const alert = state.alerts.find(entry => entry.id === body.p_alert_id); Object.assign(alert, { status: 'noted', noted_at: new Date().toISOString() }); return send(alert); }
    if (path === '/rest/v1/rpc/cancel_business_booking') {
      const alert = state.alerts.find(entry => entry.id === body.p_alert_id), entry = state.bookings.find(booking => booking.id === alert.booking_id);
      Object.assign(entry, { status: 'cancelled', cancellation_note: body.p_reason }); Object.assign(alert, { status: 'cancelled', booking_status: 'cancelled', cancellation_note: body.p_reason, booking: entry, cancelled_at: new Date().toISOString() }); return send(alert);
    }
    if (path === '/rest/v1/rpc/get_business_billing') return send({ plan: { enabled: false, monthly_price_cents: null }, subscription: null, charges: [] });
    if (path === '/rest/v1/rpc/submit_salon') return send({ ...salon, status: 'pending' });
    state.unexpected.push(`${request.method()} ${path}`); return send({ message: 'Unsupported tutorial fixture' }, 400);
  });
  return state;
}
