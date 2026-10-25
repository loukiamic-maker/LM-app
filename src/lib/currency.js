const wholeEuros = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 0 });
const fractionalEuros = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Format display amounts consistently without changing stored euro/cents values.
export function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const normalized = rounded === 0 ? 0 : rounded;
  return `€${(Number.isInteger(normalized) ? wholeEuros : fractionalEuros).format(normalized)}`;
}

export function formatEuroCents(value) {
  return formatEuro(Number(value) / 100);
}
