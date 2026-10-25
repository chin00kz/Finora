import type { Transaction } from '../db/db';
import { expensePersonalSpendAmount } from './spendingAmount';

export function getBudgetGlanceColors(percent: number, isEnabled: boolean) {
  if (!isEnabled) {
    return {
      barColor: 'bg-foreground',
      textColor: 'text-muted-foreground',
    };
  }

  if (percent < 25) {
    return {
      barColor: 'bg-muted-foreground',
      textColor: 'text-muted-foreground',
    };
  } else if (percent < 50) {
    return {
      barColor: 'bg-emerald-500',
      textColor: 'text-emerald-500',
    };
  } else if (percent < 75) {
    return {
      barColor: 'bg-amber-500',
      textColor: 'text-amber-500',
    };
  } else if (percent < 90) {
    return {
      barColor: 'bg-orange-500',
      textColor: 'text-orange-500',
    };
  } else {
    return {
      barColor: 'bg-red-500',
      textColor: 'text-red-500',
    };
  }
}

/**
 * Median personal-spend baseline for glance coloring (last 90 days).
 * Uses personal share (0 counts); includes out-of-budget expenses.
 * Does not use full cash paid — that remains for balance display only.
 */
export function getTransactionBaseline(transactions: Transaction[]): number | null {
  const recentPersonalSpend = transactions
    .filter(t => t.type === 'expense' && Date.now() - t.date < 90 * 24 * 60 * 60 * 1000)
    .map(t => Math.abs(expensePersonalSpendAmount(t)))
    .sort((a, b) => a - b);

  if (recentPersonalSpend.length < 5) return null;

  const mid = Math.floor(recentPersonalSpend.length / 2);
  const median =
    recentPersonalSpend.length % 2 !== 0
      ? recentPersonalSpend[mid]
      : (recentPersonalSpend[mid - 1] + recentPersonalSpend[mid]) / 2;

  // All-zero personal shares (e.g. fully reimbursed splits) → no glance scale
  return median > 0 ? median : null;
}

export function getTransactionGlanceColor(amount: number, type: string, baseline: number | null, isEnabled: boolean): string {
  // Income retains positive semantic color
  if (type === 'income') return 'text-emerald-500';
  
  // Transfers / balance history or disabled features remain neutral
  if (
    type === 'transfer' ||
    type === 'opening_balance' ||
    type === 'balance_adjustment' ||
    !isEnabled ||
    !baseline
  ) {
    return 'text-foreground';
  }
  
  const ratio = Math.abs(amount) / baseline;
  
  if (ratio <= 1.5) return 'text-foreground';         // Normal
  if (ratio <= 2.5) return 'text-amber-500';          // Somewhat unusual
  if (ratio <= 4.0) return 'text-orange-500';         // Large
  return 'text-red-500';                              // Exceptional
}
