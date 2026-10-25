export const phoneCountries = [
  { id: 'CY', name: 'Κύπρος', dial: '+357', min: 8, max: 8, example: '99123456' },
  { id: 'GR', name: 'Ελλάδα', dial: '+30', min: 10, max: 10, example: '6912345678' },
  { id: 'GB', name: 'Ην. Βασίλειο', dial: '+44', min: 10, max: 10, example: '7700900123' },
  { id: 'DE', name: 'Γερμανία', dial: '+49', min: 10, max: 11 },
  { id: 'FR', name: 'Γαλλία', dial: '+33', min: 9, max: 9 },
  { id: 'LU', name: 'Λουξεμβούργο', dial: '+352', min: 6, max: 11 },
  { id: 'IT', name: 'Ιταλία', dial: '+39', min: 9, max: 11 },
  { id: 'ES', name: 'Ισπανία', dial: '+34', min: 9, max: 9 },
  { id: 'NL', name: 'Ολλανδία', dial: '+31', min: 9, max: 9 },
  { id: 'BE', name: 'Βέλγιο', dial: '+32', min: 8, max: 9 },
  { id: 'IE', name: 'Ιρλανδία', dial: '+353', min: 9, max: 9 },
  { id: 'PT', name: 'Πορτογαλία', dial: '+351', min: 9, max: 9 },
  { id: 'CH', name: 'Ελβετία', dial: '+41', min: 9, max: 9 },
  { id: 'AT', name: 'Αυστρία', dial: '+43', min: 7, max: 13 },
  { id: 'BG', name: 'Βουλγαρία', dial: '+359', min: 8, max: 9 },
  { id: 'RO', name: 'Ρουμανία', dial: '+40', min: 9, max: 9 },
  { id: 'PL', name: 'Πολωνία', dial: '+48', min: 9, max: 9 },
  { id: 'US', name: 'ΗΠΑ / Καναδάς', dial: '+1', min: 10, max: 10 },
  { id: 'AU', name: 'Αυστραλία', dial: '+61', min: 9, max: 9 },
];

export function cleanPhone(value = '') {
  return String(value).trim().replace(/[\s().-]/g, '');
}

export function splitPhone(value = '') {
  const cleaned = cleanPhone(value);
  if (!cleaned) return { country: 'CY', number: '' };
  const match = [...phoneCountries].sort((a, b) => b.dial.length - a.dial.length).find(country => cleaned.startsWith(country.dial));
  return match ? { country: match.id, number: cleaned.slice(match.dial.length) } : { country: 'INTL', number: String(value) };
}

export function joinPhone(countryId, number = '') {
  if (!String(number).trim()) return '';
  const cleaned = cleanPhone(number);
  if (cleaned.startsWith('+') || countryId === 'INTL') return cleaned;
  const country = phoneCountries.find(item => item.id === countryId);
  return country ? `${country.dial}${cleaned}` : cleaned;
}

export function isValidMobilePhone(value = '') {
  const phone = cleanPhone(value);
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return false;
  const parts = splitPhone(phone);
  const country = phoneCountries.find(item => item.id === parts.country);
  return !country || (parts.number.length >= country.min && parts.number.length <= country.max);
}
