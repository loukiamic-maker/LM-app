import { mapBooking, platformError, supabase } from './platform';

async function saveManualBooking(name, values) {
  if (!supabase) throw platformError({ message: 'Backend not configured' });
  const { data, error } = await supabase.rpc(name, values);
  if (error) {
    const failure = platformError(error);
    if (/conflict|SLOT_UNAVAILABLE|overlap|23P01|slot_taken/i.test(`${error.code || ''} ${error.message || ''}`)) failure.userMessage = 'Ο επαγγελματίας έχει ήδη κράτηση ή απουσία σε αυτό το διάστημα. Επιλέξτε άλλη ώρα ή επαγγελματία';
    if (/MANUAL_BOOKING_PRICE_REQUIRED/.test(error.message || '')) failure.userMessage = 'Συμπληρώστε την τιμή του ραντεβού';
    if (/MANUAL_BOOKING_DATE_INVALID/.test(error.message || '')) failure.userMessage = 'Συμπληρώστε έγκυρη ημερομηνία και ώρα ραντεβού';
    if (['PGRST202', '42883'].includes(error.code)) failure.userMessage = 'Η νέα λειτουργία ημερολογίου χρειάζεται την ενημέρωση της βάσης από τον διαχειριστή';
    throw failure;
  }
  return mapBooking(Array.isArray(data) ? data[0] : data);
}

const bookingValues = (entry) => ({
  p_service_id: entry.serviceId,
  p_staff_id: entry.staffId,
  p_starts_at: entry.startsAt,
  p_customer_name: entry.name.trim(),
  p_customer_email: entry.email?.trim() || null,
  p_customer_phone: entry.phone?.trim() || null,
  p_duration_minutes: Number(entry.duration),
  p_price_cents: Math.round(Number(entry.price) * 100),
  p_notes: entry.notes?.trim() || '',
});

export function createManualBooking(salonId, entry, idempotencyKey) {
  return saveManualBooking('create_manual_booking', {
    p_salon_id: salonId,
    ...bookingValues(entry),
    p_idempotency_key: idempotencyKey,
  });
}

export function editManualBooking(bookingId, entry) {
  return saveManualBooking('edit_manual_booking', {
    p_booking_id: bookingId,
    ...bookingValues(entry),
  });
}
