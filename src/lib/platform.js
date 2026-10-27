import { t } from '../i18n.js';
import { createClient } from '@supabase/supabase-js';

const runtime = typeof window !== 'undefined' ? window.MERAKI_CONFIG || {} : {};
// Explicit runtime settings win over a build's defaults. Explicitly empty fields
// allow isolated demo tests without ever contacting a production project.
const runtimeOverride = Object.hasOwn(runtime, 'supabaseUrl') || Object.hasOwn(runtime, 'supabasePublishableKey');
const projectUrl = (runtimeOverride ? runtime.supabaseUrl : import.meta.env.VITE_SUPABASE_URL) || '';
const publishableKey = (runtimeOverride ? runtime.supabasePublishableKey : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) || '';

function configurationReady() {
  if (!projectUrl && !publishableKey) return false;
  try {
    const url = new URL(projectUrl);
    if (url.username || url.password) return false;
    if (url.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:')) return false;
    if (publishableKey.startsWith('sb_secret_')) return false;
    if (publishableKey.split('.').length === 3) {
      const payload = JSON.parse(atob(publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'anon') return false;
    } else if (!publishableKey.startsWith('sb_publishable_')) return false;
    return true;
  } catch { return false; }
}

export const platformReady = configurationReady();
const explicitDemo = runtime.supabaseUrl === '' && runtime.supabasePublishableKey === '';
// A production page with a missing/blocked connection file must not silently
// switch to fictional listings. Isolated demo checks can opt in with two blanks.
export const platformConfigurationError = !platformReady && (
  Boolean(projectUrl || publishableKey) || (import.meta.env.PROD && !explicitDemo)
);
export const supabase = platformReady ? createClient(projectUrl, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
}) : null;

export const authRedirectUrl = () => new URL(import.meta.env.BASE_URL, window.location.origin).toString();

export function platformError(error) {
  const code = error?.code || '';
  const message = error?.message || '';
  let userMessage = 'Η ενέργεια δεν ολοκληρώθηκε. Προσπαθήστε ξανά';
  if (/PHONE_VERIFICATION_REQUIRED|BOOKING_PHONE_MISMATCH/.test(message)) userMessage = 'Επιβεβαιώστε το κινητό σας από το προφίλ και δοκιμάστε ξανά';
  else if (/SIGNUP_FULL_NAME_REQUIRED/.test(message)) userMessage = 'Συμπληρώστε το όνομά σας με 2 έως 80 χαρακτήρες';
  else if (/PHONE_REQUIRED|PHONE_INVALID|CUSTOMER_PHONE/.test(message)) userMessage = 'Συμπληρώστε ένα έγκυρο κινητό τηλέφωνο';
  else if (/create_booking_with_contact/.test(message) && code === 'PGRST202') userMessage = 'Το σύστημα κρατήσεων χρειάζεται ενημέρωση από τη διαχείριση. Δοκιμάστε αργότερα';
  else if (/conflict|unavailable|overlap|23P01|slot_taken/i.test(`${code} ${message}`)) userMessage = 'Η ώρα δεν είναι πλέον διαθέσιμη. Επιλέξτε μια νέα ώρα';
  else if (/email.*confirm|confirm.*email|email_not_confirmed/i.test(message)) userMessage = 'Επιβεβαιώστε πρώτα το email σας από τον σύνδεσμο που λάβατε';
  else if (/Invalid login credentials/i.test(message)) userMessage = 'Το email ή ο κωδικός δεν είναι σωστός';
  else if (/already registered|already been registered/i.test(message)) userMessage = 'Αν υπάρχει ήδη λογαριασμός με αυτό το email, συνδεθείτε ή ζητήστε νέο κωδικό';
  else if (/BOOKING_LIMIT_REACHED/.test(message)) userMessage = 'Έχετε φτάσει το όριο ενεργών μελλοντικών κρατήσεων. Διαχειριστείτε πρώτα τα υπάρχοντα ραντεβού σας';
  else if (/rate.limit|too many|over_email_send_rate_limit/i.test(`${code} ${message}`)) userMessage = 'Έγιναν πολλές προσπάθειες. Περιμένετε λίγο πριν προσπαθήσετε ξανά';
  else if (/cutoff|cancellation.*period|too late|cancellation_window/i.test(message)) userMessage = 'Η προθεσμία ηλεκτρονικής αλλαγής έχει λήξει. Επικοινωνήστε με το κατάστημα';
  else if (/not authorized|not authenticated|permission|42501|PGRST301|JWT.*expired/i.test(`${code} ${message}`)) userMessage = 'Συνδεθείτε με τον λογαριασμό που έχει πρόσβαση σε αυτή την ενέργεια';
  else if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message)) userMessage = 'Δεν υπάρχει σύνδεση με τον διακομιστή. Ελέγξτε τη σύνδεσή σας και προσπαθήστε ξανά';
  else if (/hours|schedule|time.off|invalid.*time|outside|notice/i.test(message)) userMessage = 'Η ώρα δεν βρίσκεται στο διαθέσιμο ωράριο του καταστήματος';
  else if (/published|inactive|not found/i.test(message)) userMessage = 'Αυτή η υπηρεσία ή το κατάστημα δεν είναι διαθέσιμο για κράτηση';
  const result = new Error(message || userMessage);
  result.userMessage = t(userMessage);
  result.code = code;
  return result;
}

function client() {
  if (!supabase) throw Object.assign(new Error('Backend not configured'), { userMessage: t('Η υπηρεσία κρατήσεων δεν έχει συνδεθεί ακόμα') });
  return supabase;
}

async function result(query) {
  const { data, error } = await query;
  if (error) throw platformError(error);
  return data;
}

const one = value => Array.isArray(value) ? value[0] : value;
const zoneFor = country => country === 'Κύπρος' ? 'Europe/Nicosia' : 'Europe/Athens';
const dateIn = (value, timeZone) => new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(value));
const timeIn = (value, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));

export function mapSalon(row) {
  return {
    id: row.id, ownerId: row.owner_id, name: row.name, category: row.category,
    city: row.city, country: row.country, address: row.address,
    location: [row.address, row.city].filter(Boolean).join(', '),
    timezone: row.timezone || zoneFor(row.country), description: row.description || '',
    photoIndex: row.photo_index ?? 8, imageUrl: row.image_url || null,
    cancellationHours: row.cancellation_hours ?? 24, status: row.status,
    rating: null, reviewCount: 0, isDemo: false,
    services: (row.services || []).map(s => ({ id: s.id, name: s.name, duration: s.duration_minutes, price: s.price_cents / 100, active: s.active })),
    staff: (row.staff || []).map(s => ({ id: s.id, name: s.name, active: s.active })),
    hours: row.hours || [], timeOff: row.timeOff || [],
  };
}

const listingColumns = '*,services(*),staff(*)';
export async function listSalons() {
  const rows = await result(client().from('salons').select(listingColumns).eq('status', 'published').order('name'));
  return (rows || []).map(row => mapSalon({ ...row, services: row.services.filter(s => s.active), staff: row.staff.filter(s => s.active) })).filter(s => s.services.length && s.staff.length);
}

export async function listOwnSalons() {
  const { data: { user }, error } = await client().auth.getUser();
  if (error) throw platformError(error);
  if (!user) return [];
  const rows = await result(client().from('salons').select(listingColumns).eq('owner_id', user.id).order('created_at'));
  const mapped = await Promise.all((rows || []).map(async row => {
    const staffIds = row.staff.map(s => s.id);
    const [hours, timeOff] = staffIds.length ? await Promise.all([
      result(client().from('staff_hours').select('*').in('staff_id', staffIds)),
      result(client().from('staff_time_off').select('*').in('staff_id', staffIds).order('starts_at')),
    ]) : [[], []];
    return mapSalon({ ...row, hours, timeOff });
  }));
  return mapped;
}

export async function getSlots(serviceId, date, staffId = null) {
  const rows = await result(client().rpc('get_availability', { p_service_id: serviceId, p_date: date, p_staff_id: staffId }));
  return (rows || []).map(row => ({ staffId: row.staff_id, staffName: row.staff_name, startsAt: row.starts_at, endsAt: row.ends_at, time: row.local_time }));
}

export async function mapBooking(row, knownSalon) {
  if (!row) throw new Error('No booking returned');
  const [salon, staff] = await Promise.all([
    knownSalon || (row.salon_name ? { name: row.salon_name, country: row.country, timezone: row.timezone, cancellation_hours: row.cancellation_hours } : result(client().from('salons').select('id,name,country,timezone,cancellation_hours').eq('id', row.salon_id).single())),
    row.staff_name ? { name: row.staff_name } : result(client().from('staff').select('id,name').eq('id', row.staff_id).single()),
  ]);
  const zone = salon.timezone || zoneFor(salon.country);
  return {
    id: row.id, salonId: row.salon_id, salonName: salon.name,
    service: { id: row.service_id, name: row.service_name, price: row.price_cents / 100, duration: Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 60000) },
    staffId: row.staff_id, staff: staff.name,
    startsAt: row.starts_at, endsAt: row.ends_at, date: dateIn(row.starts_at, zone), time: timeIn(row.starts_at, zone),
    name: row.customer_name, email: row.customer_email || '', payment: 'venue', status: row.status,
    source: row.booking_source || 'online', phone: row.customer_phone || '', notes: row.notes || '', cancellationNote: row.cancellation_note || '', createdBy: row.created_by || null,
    paymentStatus: row.payment_status, createdAt: row.created_at, country: salon.country,
    cancellationHours: row.cancellation_hours ?? salon.cancellation_hours ?? 24,
  };
}

export async function createBooking({ serviceId, staffId, startsAt, customerName, requestId, customerPhone, notes = '' }) {
  const row = one(await result(client().rpc('create_booking_with_contact', { p_service_id: serviceId, p_staff_id: staffId, p_starts_at: startsAt, p_customer_name: customerName, p_idempotency_key: requestId, p_customer_phone: customerPhone?.trim() || '', p_notes: notes.trim() })));
  return mapBooking(row);
}

export async function listBookings() {
  const { data: { user }, error } = await client().auth.getUser();
  if (error) throw platformError(error);
  if (!user) return [];
  const rows = await result(client().from('bookings').select('*').eq('customer_id', user.id).order('starts_at'));
  return Promise.all((rows || []).map(row => mapBooking(row)));
}

export async function cancelBooking(id) {
  return mapBooking(one(await result(client().rpc('cancel_booking', { p_booking_id: id }))));
}

export async function rescheduleBooking({ bookingId, staffId, startsAt }) {
  return mapBooking(one(await result(client().rpc('reschedule_booking', { p_booking_id: bookingId, p_staff_id: staffId, p_starts_at: startsAt }))));
}

export async function updateProfile({ name, mobilePhone }) {
  const { data: { user } } = await client().auth.getUser();
  if (!user) throw platformError({ code: '42501' });
  const values = { user_id: user.id, full_name: name.trim() };
  if (mobilePhone !== undefined) values.mobile_phone = mobilePhone.trim() || null;
  await result(client().from('profiles').upsert(values));
}

export async function createSalon({ name, city, country, category, address }) {
  return mapSalon(one(await result(client().rpc('create_salon', { p_name: name, p_city: city, p_country: country, p_category: category, p_address: address }))));
}

export async function updateSalon(id, patch) {
  const allowed = { name: 'name', city: 'city', country: 'country', address: 'address', description: 'description', category: 'category', cancellationHours: 'cancellation_hours', imageUrl: 'image_url' };
  const safe = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed[key]).map(([key, value]) => [allowed[key], value]));
  return mapSalon(await result(client().from('salons').update(safe).eq('id', id).select(listingColumns).single()));
}

export async function submitSalon(id) { return mapSalon(one(await result(client().rpc('submit_salon', { p_salon_id: id })))); }

export async function saveStaff(salonId, staff) {
  const values = { name: staff.name.trim(), active: staff.active ?? true };
  return result(staff.id ? client().from('staff').update(values).eq('id', staff.id).eq('salon_id', salonId).select().single() : client().from('staff').insert({ ...values, salon_id: salonId }).select().single());
}

export async function saveService(salonId, service) {
  const values = { name: service.name.trim(), duration_minutes: Number(service.duration), price_cents: Math.round(Number(service.price) * 100), active: service.active ?? true };
  return result(service.id ? client().from('services').update(values).eq('id', service.id).eq('salon_id', salonId).select().single() : client().from('services').insert({ ...values, salon_id: salonId }).select().single());
}

export async function saveHours(staffId, hours) {
  return result(client().rpc('replace_staff_hours', { p_staff_id: staffId, p_hours: hours }));
}

export async function saveTimeOff(staffId, entry) {
  return result(client().from('staff_time_off').insert({ staff_id: staffId, starts_at: entry.starts_at, ends_at: entry.ends_at, reason: entry.reason || '' }).select().single());
}

export async function deleteTimeOff(id) { await result(client().from('staff_time_off').delete().eq('id', id)); }

export async function listBusinessBookings(salonId, date) {
  const salon = await result(client().from('salons').select('id,name,country,timezone,cancellation_hours').eq('id', salonId).single());
  const timezone = salon.timezone || zoneFor(salon.country);
  const midnight = value => {
    const target = Date.parse(`${value}T00:00:00Z`);
    let instant = target;
    const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
      instant += target - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    }
    return new Date(instant).toISOString();
  };
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const start = midnight(date), end = midnight(next.toISOString().slice(0, 10));
  // Include appointments that began the previous day and continue after midnight.
  const rows = await result(client().from('bookings').select('*').eq('salon_id', salonId).gt('ends_at', start).lt('starts_at', end).order('starts_at'));
  const bookings = await Promise.all((rows || []).map(row => mapBooking(row, salon)));
  return bookings.filter(booking => Date.parse(booking.endsAt) > Date.parse(start) && Date.parse(booking.startsAt) < Date.parse(end));
}

export async function completeBooking(id, paid) { return mapBooking(one(await result(client().rpc('complete_booking', { p_booking_id: id, p_paid: paid })))); }
