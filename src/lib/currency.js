import { getLocale } from '../i18n.js';
const formats = new Map();
function euroFormats() {
  const locale = getLocale();
  if (!formats.has(locale)) formats.set(locale, [new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })]);
  return formats.get(locale);
}

// Format display amounts consistently without changing stored euro/cents values.
export function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const normalized = rounded === 0 ? 0 : rounded;
  const [wholeEuros, fractionalEuros] = euroFormats();
  return `€${(Number.isInteger(normalized) ? wholeEuros : fractionalEuros).format(normalized)}`;
}

export function formatEuroCents(value) {
  return formatEuro(Number(value) / 100);
}
