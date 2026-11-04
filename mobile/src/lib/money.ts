// COP has no cents in practice; the API stores minor units (×100) like every other currency.
const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export const formatCOP = (minor: number) => fmt.format(Math.trunc(minor / 100));

/** "15.000" / "15000" → 1500000. Null when empty or zero. */
export function parsePesos(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  return digits && Number(digits) > 0 ? Number(digits) * 100 : null;
}

/** Device-local date as YYYY-MM-DD (transactions are dated in the user's day, not UTC). */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
