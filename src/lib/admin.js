import { t } from '../i18n.js';
import { platformError, supabase } from './platform';

const withoutStop = text => String(text || '').replace(/\.\s*$/, '');

export function managementError(error) {
  const message = String(error?.message || error?.code || '');
  let userMessage;
  if (/ADMIN_REQUIRED|ADMIN_ONLY|ADMIN_FORBIDDEN/.test(message)) userMessage = t('Ο λογαριασμός δεν έχει δικαιώματα διαχείρισης');
  else if (/PGRST202|Could not find the function|does not exist|schema cache/i.test(message)) userMessage = t('Η ενημέρωση διαχείρισης δεν έχει εγκατασταθεί ακόμη στη βάση');
  else if (/SALON_SETUP_INCOMPLETE/.test(message)) userMessage = t('Συμπληρώστε ενεργές υπηρεσίες, επαγγελματίες και ωράριο πριν από την έγκριση');
  else if (/BILLING_PRICE|PRICE_REQUIRED|BILLING_NOT_CONFIGURED/.test(message)) userMessage = t('Ορίστε πρώτα τη μηνιαία τιμή συνδρομής');
  else if (/BILLING_ALREADY_ACTIVE/.test(message)) userMessage = t('Υπάρχει ήδη ενεργή συνδρομή για την επιχείρηση');
  else if (/BILLING_CHECKOUT_IN_PROGRESS/.test(message)) userMessage = t('Μια προσπάθεια ενεργοποίησης βρίσκεται ήδη σε εξέλιξη — περιμένετε λίγο και ανανεώστε');
  else if (/BILLING_PERIOD_ALREADY_PAID/.test(message)) userMessage = t('Η τρέχουσα περίοδος έχει ήδη εξοφληθεί — μπορείτε να ενεργοποιήσετε την πληρωμή με κάρτα μετά τη λήξη της');
  else if (/BILLING_UPDATE_PENDING/.test(message)) userMessage = t('Η ενημέρωση της συνδρομής βρίσκεται σε εξέλιξη — ανανεώστε τα στοιχεία σε λίγο');
  else if (/PAYMENT_NOT_CONFIGURED|STRIPE_NOT_CONFIGURED/.test(message)) userMessage = t('Η πληρωμή με κάρτα δεν είναι διαθέσιμη ακόμη');
  else if (/CHARGE_ALREADY|CHARGE_NOT_PENDING/.test(message)) userMessage = t('Η χρέωση έχει ήδη ενημερωθεί — ανανεώστε τα στοιχεία');
  else if (/PERIOD|DUE_DATE|AMOUNT_INVALID|PRICE_INVALID/.test(message)) userMessage = t('Ελέγξτε την περίοδο, την ημερομηνία και το ποσό της χρέωσης');
  else userMessage = withoutStop(error?.userMessage || platformError(error).userMessage);
  return Object.assign(new Error(message || userMessage), { code: error?.code, userMessage });
}

async function rpc(name, params = {}) {
  if (!supabase) throw managementError({ message: 'Η υπηρεσία δεν έχει συνδεθεί' });
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw managementError(error);
  return data;
}

export const getAdminOverview = (days = 30) => rpc('admin_overview', { p_days: days });
export const getAdminSalons = (status = null) => rpc('admin_list_salons', { p_status: status || null });
export const getAdminSalon = salonId => rpc('admin_get_salon', { p_salon_id: salonId });
export const reviewSalon = (salonId, decision, note = '') => rpc('admin_review_salon', { p_salon_id: salonId, p_decision: decision, p_note: note.trim() });
export const getPlatformBilling = () => rpc('get_platform_billing');
export const setPlatformBilling = (monthlyPriceCents, enabled) => rpc('admin_set_platform_billing', { p_monthly_price_cents: monthlyPriceCents, p_enabled: enabled });
export const setBusinessSubscription = (salonId, monthlyPriceCents, status) => rpc('admin_set_business_subscription', {
  p_salon_id: salonId, p_monthly_price_cents: monthlyPriceCents, p_status: status, p_provider: 'manual',
});
export const createBusinessCharge = ({ salonId, periodStart, periodEnd, amountCents, dueDate }) => rpc('admin_create_business_charge', {
  p_salon_id: salonId, p_period_start: periodStart, p_period_end: periodEnd,
  p_amount_cents: amountCents, p_due_date: dueDate || null,
});
export const setChargeStatus = (chargeId, status, reference = '') => rpc('admin_set_charge_status', { p_charge_id: chargeId, p_status: status, p_reference: reference.trim() });
export const getBusinessBilling = salonId => rpc('get_business_billing', { p_salon_id: salonId });

export async function refreshAdminAccess() {
  if (!supabase) throw managementError({ message: 'Η υπηρεσία δεν έχει συνδεθεί' });
  const { error } = await supabase.auth.refreshSession();
  if (error) throw managementError(error);
}

export async function startSubscriptionCheckout(salonId, requestId, action = 'subscribe') {
  if (!supabase) throw managementError({ message: 'Η υπηρεσία δεν έχει συνδεθεί' });
  const { data, error } = await supabase.functions.invoke('create-subscription-checkout', { body: { salon_id: salonId, request_id: requestId, action } });
  if (error) {
    let body;
    try { body = await error.context?.json(); } catch { /* Provider errors remain server-side */ }
    throw managementError({ ...error, code: body?.code || error.code, message: body?.code || body?.error || error.message });
  }
  if (data?.error || data?.code) throw managementError({ message: data.code || data.error });
  if (action === 'status') return { configured: data?.configured === true, manage_configured: (data?.manage_configured ?? data?.configured) === true };
  try {
    const url = new URL(data?.url);
    if (url.protocol !== 'https:' || url.username || url.password || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error();
    return { ...data, url: url.toString() };
  } catch {
    throw Object.assign(new Error('Invalid hosted checkout address'), { userMessage: t('Ο σύνδεσμος πληρωμής δεν είναι διαθέσιμος — προσπαθήστε ξανά') });
  }
}
