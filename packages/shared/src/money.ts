/** Monetary amounts are stored as integers in minor units (paise for INR). */
export function formatMoney(minor: number, currency = 'INR'): string {
  const major = minor / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

export function toMinor(major: number): number {
  return Math.round(major * 100);
}
