/**
 * Pure budget period / one-active helpers (Node-test safe).
 */
import { differenceInDays } from 'date-fns';
import type { Budget } from '../db/db';

export type BudgetLike = Pick<
  Budget,
  'id' | 'status' | 'startDate' | 'endDate' | 'updatedAt' | 'amount' | 'name'
>;

/** Format a Date as local YYYY-MM-DD for <input type="date">. */
export function formatLocalDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localMidnightMs(y: number, mZeroBased: number, d: number): number {
  return new Date(y, mZeroBased, d).getTime();
}

export function localEndOfDayMs(y: number, mZeroBased: number, d: number): number {
  return new Date(y, mZeroBased, d, 23, 59, 59, 999).getTime();
}

/**
 * Parse budget start/end from local date strings.
 * Start = today → use `now` so earlier-today txns are excluded.
 * End = local end-of-day.
 */
export function parseBudgetDateBounds(
  startDateStr: string,
  endDateStr: string,
  now: number = Date.now(),
): { startDate: number; endDate: number; periodLengthDays: number } | { error: string } {
  if (!startDateStr || !endDateStr) {
    return { error: 'Start and end dates are required.' };
  }
  const startParts = startDateStr.split('-').map(Number);
  const endParts = endDateStr.split('-').map(Number);
  if (startParts.length !== 3 || endParts.length !== 3) {
    return { error: 'Invalid date format.' };
  }
  const [sy, sm, sd] = startParts;
  const [ey, em, ed] = endParts;
  if ([sy, sm, sd, ey, em, ed].some(n => !Number.isFinite(n))) {
    return { error: 'Invalid date format.' };
  }

  const today = new Date(now);
  const todayMidnight = localMidnightMs(today.getFullYear(), today.getMonth(), today.getDate());
  const parsedStart = localMidnightMs(sy!, sm! - 1, sd!);
  const startDate = parsedStart === todayMidnight ? now : parsedStart;
  const endDate = localEndOfDayMs(ey!, em! - 1, ed!);

  if (endDate < startDate) {
    return { error: 'End date must be after start date.' };
  }

  const periodLengthDays = differenceInDays(endDate, startDate) + 1;
  return { startDate, endDate, periodLengthDays };
}

/**
 * Resolve the single active budget. Prefer latest startDate, then updatedAt.
 * Does not mutate storage — use healMultipleActiveBudgets for persistence.
 */
export function resolveActiveBudget<T extends BudgetLike>(budgets: T[]): T | undefined {
  const actives = budgets.filter(b => b.status === 'active');
  if (actives.length === 0) return undefined;
  if (actives.length === 1) return actives[0];
  return [...actives].sort((a, b) => {
    if (b.startDate !== a.startDate) return b.startDate - a.startDate;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  })[0];
}

/**
 * When ending an active budget (manual or replaced), clip endDate so the
 * historical window stops now and cannot overlap a newly started period.
 */
export function clippedEndDateForEndedBudget(
  budget: Pick<BudgetLike, 'startDate' | 'endDate'>,
  now: number = Date.now(),
): number {
  // Use now-1 so a replacement budget starting at `now` does not share the boundary ms.
  const clip = Math.min(budget.endDate, now - 1);
  return Math.max(budget.startDate, clip);
}

export function patchForEndingBudget(
  budget: Pick<BudgetLike, 'startDate' | 'endDate'>,
  now: number = Date.now(),
): { status: 'ended'; endDate: number; updatedAt: number } {
  return {
    status: 'ended',
    endDate: clippedEndDateForEndedBudget(budget, now),
    updatedAt: now,
  };
}

/**
 * Infer status when cloud/legacy rows omit it (fail toward ended if window passed).
 */
export function inferBudgetStatus(
  status: unknown,
  startDate: number,
  endDate: number,
  now: number = Date.now(),
): Budget['status'] {
  if (status === 'active' || status === 'ended' || status === 'archived') {
    return status;
  }
  if (endDate < now) return 'ended';
  if (startDate > now) return 'ended';
  return 'active';
}

/** Analytics/Export: true only when viewing a real budget window. */
export function isBudgetAnalyticsPeriod(
  periodKey: string,
  hasActiveBudget: boolean,
): boolean {
  if (periodKey.startsWith('budget_')) return true;
  if (periodKey === 'current') return hasActiveBudget;
  return false;
}

/**
 * Given multiple actives, return ids that should be ended (all except winner).
 */
export function activeBudgetIdsToHeal<T extends BudgetLike>(budgets: T[]): {
  keepId: string | undefined;
  endIds: string[];
} {
  const actives = budgets.filter(b => b.status === 'active');
  if (actives.length <= 1) {
    return { keepId: actives[0]?.id, endIds: [] };
  }
  const keep = resolveActiveBudget(actives);
  return {
    keepId: keep?.id,
    endIds: actives.filter(b => b.id !== keep?.id).map(b => b.id),
  };
}
