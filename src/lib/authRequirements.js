import { supabase } from './platform';

// Older installations retain their existing email sign-in until the additive
// phone-auth migration and the SMS/email providers have been activated.
export async function fetchAuthRequirements() {
  if (!supabase) return { require_verified_phone: false };
  const { data, error } = await supabase.rpc('get_auth_requirements');
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) return { require_verified_phone: false };
    throw error;
  }
  const value = Array.isArray(data) ? data[0] : data;
  if (typeof value?.require_verified_phone !== 'boolean') throw new Error('AUTH_REQUIREMENTS_UNAVAILABLE');
  return value;
}

export const canonicalAuthPhone = value => {
  const digits = String(value || '').trim().replace(/^\+/, '');
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : '';
};
