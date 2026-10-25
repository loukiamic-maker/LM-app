import { mapBooking, platformError, supabase } from './platform';

export function bookingAlertError(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`;
  let userMessage;
  if (/PGRST202|42883|schema cache|Could not find the function/i.test(message)) userMessage = 'Οι ειδοποιήσεις κρατήσεων χρειάζονται την ενημέρωση της βάσης από τον διαχειριστή';
  else if (/BOOKING_ALERT_NOT_FOUND/.test(message)) userMessage = 'Αυτή η ενημέρωση δεν είναι πλέον διαθέσιμη. Ανανεώστε το ιστορικό';
  else if (/REASON|CANCELLATION_NOTE|CANCELLATION_REASON/.test(message)) userMessage = 'Γράψτε τον λόγο ακύρωσης, από 2 έως 2000 χαρακτήρες';
  else if (/ALREADY_CANCELLED|ALERT_CANCELLED|BOOKING_CANCELLED|BOOKING_NOT_CONFIRMED|BOOKING_NOT_ACTIVE|BOOKING_STATUS/.test(message)) userMessage = 'Η κράτηση έχει ήδη ενημερωθεί. Ανανεώστε το ιστορικό για την τρέχουσα κατάσταση';
  else userMessage = error?.userMessage || platformError(error).userMessage;
  return Object.assign(new Error(error?.message || userMessage), { code: error?.code, userMessage });
}

async function rpc(name, params) {
  if (!supabase) throw bookingAlertError({ message: 'Backend not configured' });
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw bookingAlertError(error);
  return data;
}

export function normalizeBusinessAlert(row) {
  if (!row?.id) {
    const userMessage = 'Δεν λάβαμε επιβεβαίωση της ενημέρωσης. Ανανεώστε το ιστορικό πριν δοκιμάσετε ξανά';
    throw Object.assign(new Error(userMessage), { userMessage });
  }
  const booking = row?.booking || {};
  return {
    ...row,
    booking_id: row.booking_id || booking.id,
    customer_name: row.customer_name ?? booking.customer_name ?? '',
    customer_email: row.customer_email ?? booking.customer_email ?? '',
    customer_phone: row.customer_phone ?? booking.customer_phone ?? '',
    service_name: row.service_name ?? booking.service_name ?? '',
    staff_name: row.staff_name ?? booking.staff_name ?? '',
    starts_at: row.starts_at || booking.starts_at,
    ends_at: row.ends_at || booking.ends_at,
    price_cents: row.price_cents ?? booking.price_cents,
    timezone: row.timezone || booking.timezone,
    booking_status: row.booking_status || booking.status,
    cancellation_note: row.cancellation_note || booking.cancellation_note || '',
    notes: row.notes ?? booking.notes ?? '',
  };
}

export async function listBusinessBookingAlerts(salonId, offset = 0, limit = 100) {
  const data = await rpc('list_business_booking_alerts', { p_salon_id: salonId, p_limit: limit, p_offset: offset });
  return (Array.isArray(data) ? data : []).map(normalizeBusinessAlert);
}

export async function acknowledgeBusinessBooking(alertId) {
  const data = await rpc('acknowledge_business_booking', { p_alert_id: alertId });
  return normalizeBusinessAlert(Array.isArray(data) ? data[0] : data);
}

export async function cancelBusinessBooking(alertId, reason) {
  const data = await rpc('cancel_business_booking', { p_alert_id: alertId, p_reason: reason.trim() });
  return normalizeBusinessAlert(Array.isArray(data) ? data[0] : data);
}

export async function cancelBookingWithNote(bookingId, reason) {
  const data = await rpc('cancel_booking_with_note', { p_booking_id: bookingId, p_reason: reason.trim() });
  return mapBooking(Array.isArray(data) ? data[0] : data);
}
