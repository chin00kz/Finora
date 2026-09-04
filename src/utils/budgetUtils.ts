export interface BudgetStatusInfo {
  isOverspent: boolean;
  remaining: number; // Absolute value if overspent
  rawRemaining: number;
  label: 'overspent' | 'left';
  barColor: string;
  dotColor: string;
  glowColor: string;
  textColor: string;
  percent: number; // Clamped 0-100 for bar width
  actualPercent: number; // Unclamped percentage
}

/**
 * Calculates status, copy, and color-coding for a budget based on actual spending.
 * Colors progress smoothly:
 *  - < 50% spent: Green (Emerald)
 *  - 50% – 74% spent: Blue
 *  - 75% – 99% spent: Yellow / Amber
 *  - 100%+ spent or over budget: Red
 */
export function getBudgetStatus(spent: number, total: number): BudgetStatusInfo {
  const rawRemaining = total - spent;
  const isOverspent = rawRemaining < 0;
  const ratio = total > 0 ? spent / total : 0;
  const actualPercent = Math.round(ratio * 100);
  const percent = Math.min(100, Math.max(0, ratio * 100));

  if (isOverspent || ratio >= 1) {
    return {
      isOverspent,
      remaining: Math.abs(rawRemaining),
      rawRemaining,
      label: isOverspent ? 'overspent' : 'left',
      barColor: 'bg-red-500',
      dotColor: 'bg-red-500',
      glowColor: 'shadow-red-500/50',
      textColor: 'text-red-500',
      percent: 100,
      actualPercent,
    };
  }

  if (ratio >= 0.75) {
    return {
      isOverspent: false,
      remaining: rawRemaining,
      rawRemaining,
      label: 'left',
      barColor: 'bg-amber-500',
      dotColor: 'bg-amber-500',
      glowColor: 'shadow-amber-500/50',
      textColor: 'text-amber-500',
      percent,
      actualPercent,
    };
  }

  if (ratio >= 0.5) {
    return {
      isOverspent: false,
      remaining: rawRemaining,
      rawRemaining,
      label: 'left',
      barColor: 'bg-blue-500',
      dotColor: 'bg-blue-500',
      glowColor: 'shadow-blue-500/50',
      textColor: 'text-blue-500',
      percent,
      actualPercent,
    };
  }

  return {
    isOverspent: false,
    remaining: rawRemaining,
    rawRemaining,
    label: 'left',
    barColor: 'bg-emerald-500',
    dotColor: 'bg-emerald-500',
    glowColor: 'shadow-emerald-500/50',
    textColor: 'text-emerald-500',
    percent,
    actualPercent,
  };
}

