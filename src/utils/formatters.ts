/**
 * formatters.ts
 *
 * Central currency and number formatting helpers.
 * Use formatMoney() everywhere instead of `LKR ${amount.toLocaleString()}`.
 * This ensures consistent locale, currency symbol, and privacy-mask compatibility.
 */

/**
 * Format a number as a full currency string.
 * @example formatMoney(5000)        → "LKR 5,000"
 * @example formatMoney(5000.50)     → "LKR 5,000.5"
 * @example formatMoney(1234.56, '$') → "$ 1,234.56"
 */
export function formatMoney(amount: number, currency = 'LKR'): string {
  return `${currency} ${amount.toLocaleString('en-LK')}`;
}

/**
 * Format a number as a compact currency string for tight spaces.
 * @example formatMoneyCompact(1500000) → "LKR 1.5M"
 * @example formatMoneyCompact(12500)   → "LKR 12.5K"
 * @example formatMoneyCompact(999)     → "LKR 999"
 */
export function formatMoneyCompact(amount: number, currency = 'LKR'): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${currency} ${(amount / 1_000).toFixed(1)}K`;
  return formatMoney(amount, currency);
}
