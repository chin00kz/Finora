import { differenceInDays } from 'date-fns';

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
  paceState: 'on_track' | 'ahead_of_pace' | 'in_danger';
  paceWarning?: string;
}

/**
 * Calculates status, copy, and color-coding for a budget based on actual spending and pace.
 * Intelligent status bar colors:
 *  - Green (Emerald): Spending is comfortably on pace
 *  - Amber: Spending is getting ahead of pace
 *  - Red: Overspent or burning through budget in danger
 */
export function getBudgetStatus(
  spent: number,
  total: number,
  period?: { startDate: number; endDate: number }
): BudgetStatusInfo {
  const rawRemaining = total - spent;
  const isOverspent = rawRemaining < 0;
  const ratio = total > 0 ? spent / total : 0;
  const actualPercent = Math.round(ratio * 100);
  const percent = Math.min(100, Math.max(0, ratio * 100));

  if (isOverspent || (total > 0 && spent >= total)) {
    return {
      isOverspent: true,
      remaining: Math.abs(rawRemaining),
      rawRemaining,
      label: 'overspent',
      barColor: 'bg-red-500',
      dotColor: 'bg-red-500',
      glowColor: 'shadow-red-500/50',
      textColor: 'text-red-500',
      percent: 100,
      actualPercent,
      paceState: 'in_danger',
      paceWarning: 'Budget exceeded',
    };
  }

  // If period dates are provided, evaluate spending pace against elapsed days
  if (period && period.startDate && period.endDate && total > 0) {
    const now = Date.now();
    const totalDays = Math.max(1, differenceInDays(period.endDate, period.startDate) + 1);
    const daysElapsed = Math.max(1, Math.min(totalDays, differenceInDays(now, period.startDate) + 1));
    const expectedSpendRate = total / totalDays;
    const actualSpendRate = spent / daysElapsed;

    if (actualSpendRate > expectedSpendRate * 1.25) {
      return {
        isOverspent: false,
        remaining: rawRemaining,
        rawRemaining,
        label: 'left',
        barColor: 'bg-red-500',
        dotColor: 'bg-red-500',
        glowColor: 'shadow-red-500/50',
        textColor: 'text-red-500',
        percent,
        actualPercent,
        paceState: 'in_danger',
        paceWarning: 'Spending faster than planned',
      };
    }

    if (actualSpendRate > expectedSpendRate) {
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
        paceState: 'ahead_of_pace',
        paceWarning: 'Spending faster than planned',
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
      paceState: 'on_track',
      paceWarning: undefined,
    };
  }

  // Fallback if no period dates are provided
  if (ratio >= 0.85) {
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
      paceState: 'ahead_of_pace',
      paceWarning: 'Approaching limit',
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
    paceState: 'on_track',
    paceWarning: undefined,
  };
}

