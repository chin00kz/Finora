/**
 * Pure budget period / one-active helpers (Node-test safe).
 */
import { differenceInDays, addDays } from 'date-fns';
import type { Budget } from '../db/db';

export type BudgetLike = Pick<
  Budget,
  'id' | 'status' | 'startDate' | 'endDate' | 'updatedAt' | 'amount' | 'name' | 'periodLength'
>;

/** Deterministic id for a continuation period — blocks duplicate continue of the same source. */
export function continuationBudgetId(fromBudgetId: string): string {
  return `bud-cont-${fromBudgetId}`;
}

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
 * Default start = local midnight of the selected day (incl. today for greenfield).
 * End = local end-of-day. Use `resolveCreatePeriodBounds` for create handoff.
 */
export function parseBudgetDateBounds(
  startDateStr: string,
  endDateStr: string,
  _now: number = Date.now(),
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

  // Always local midnight of the selected start day (today included for greenfield).
  // `_now` kept for call-site / edit-helper signature compatibility.
  const startDate = localMidnightMs(sy!, sm! - 1, sd!);
  const endDate = localEndOfDayMs(ey!, em! - 1, ed!);

  if (endDate < startDate) {
    return { error: 'End date must be after start date.' };
  }

  const periodLengthDays = differenceInDays(endDate, startDate) + 1;
  return { startDate, endDate, periodLengthDays };
}

/**
 * Option C: same-day replace / Manual End→Create uses handoff timestamp `now`
 * as start (not midnight). Greenfield create today stays midnight.
 * True when the selected start day is today AND an active exists or a
 * same-calendar-day ended row would handoff-clip.
 */
export function isCreateHandoffContext(
  budgets: Array<Pick<BudgetLike, 'id' | 'status' | 'startDate' | 'endDate'>>,
  startDateStr: string,
  now: number = Date.now(),
): boolean {
  const todayStr = formatLocalDateInput(new Date(now));
  if (startDateStr !== todayStr) return false;
  if (budgets.some(b => b.status === 'active')) return true;
  const todayMidnight = localMidnightMs(
    new Date(now).getFullYear(),
    new Date(now).getMonth(),
    new Date(now).getDate(),
  );
  return budgets.some(b => isSameDayCreateHandoffEnded(b, todayMidnight, budgets));
}

/**
 * Create period bounds: greenfield/past → midnight start; same-day handoff → `now`.
 */
export function resolveCreatePeriodBounds(
  startDateStr: string,
  endDateStr: string,
  now: number,
  handoffSameDay: boolean,
): { startDate: number; endDate: number; periodLengthDays: number } | { error: string } {
  const parsed = parseBudgetDateBounds(startDateStr, endDateStr, now);
  if ('error' in parsed) return parsed;
  const todayStr = formatLocalDateInput(new Date(now));
  if (handoffSameDay && startDateStr === todayStr) {
    if (parsed.endDate < now) {
      return { error: 'End date must be after the handoff time.' };
    }
    return {
      startDate: now,
      endDate: parsed.endDate,
      periodLengthDays: differenceInDays(parsed.endDate, now) + 1,
    };
  }
  return parsed;
}

/**
 * Edit-bounds resolver: if the start calendar day is unchanged, keep the exact
 * stored `startDate` (avoids re-binding "today" to a new `now` on save).
 */
export function resolveBudgetEditBounds(
  existing: Pick<BudgetLike, 'startDate' | 'endDate'>,
  startDateStr: string,
  endDateStr: string,
  now: number = Date.now(),
): { startDate: number; endDate: number; periodLengthDays: number } | { error: string } {
  const bounds = parseBudgetDateBounds(startDateStr, endDateStr, now);
  if ('error' in bounds) return bounds;

  const existingStartDay = formatLocalDateInput(new Date(existing.startDate));
  if (startDateStr === existingStartDay) {
    const startDate = existing.startDate;
    if (bounds.endDate < startDate) {
      return { error: 'End date must be after start date.' };
    }
    return {
      startDate,
      endDate: bounds.endDate,
      periodLengthDays: differenceInDays(bounds.endDate, startDate) + 1,
    };
  }
  return bounds;
}

/** Inclusive range overlap (ms). */
export function budgetRangesOverlap(
  a: { startDate: number; endDate: number },
  b: { startDate: number; endDate: number },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * Find a non-archived budget whose window overlaps `range`.
 * Archived rows are ignored (hidden history). `excludeId` skips self on edit.
 */
export function findOverlappingBudget<T extends BudgetLike>(
  range: { startDate: number; endDate: number },
  budgets: T[],
  excludeId?: string,
): T | undefined {
  return budgets.find(b => {
    if (b.status === 'archived') return false;
    if (excludeId && b.id === excludeId) return false;
    return budgetRangesOverlap(range, b);
  });
}

/**
 * When replacing an active with a new period: clip so the old window ends
 * before `newPeriodStart` (and not after now). Inclusive ranges then abut
 * without overlap: old … [start, newStart-1], new … [newStart, end].
 *
 * If the prior period started later the same day (legacy today-start = Date.now()),
 * `Math.max(startDate, newStart-1)` would keep end >= newStart and the overlap
 * would remain. In that case also pull startDate down so the prior window is
 * ordered and ends strictly before the new period.
 */
export function clippedEndDateForReplacedBudget(
  budget: Pick<BudgetLike, 'startDate' | 'endDate'>,
  newPeriodStart: number,
  now: number = Date.now(),
): number {
  return boundsForCreateHandoffPrior(budget, newPeriodStart, now).endDate;
}

/** Prior-period bounds after create/replace handoff (end always < newPeriodStart). */
export function boundsForCreateHandoffPrior(
  budget: Pick<BudgetLike, 'startDate' | 'endDate'>,
  newPeriodStart: number,
  now: number = Date.now(),
): { startDate: number; endDate: number } {
  const endDate = Math.min(budget.endDate, now - 1, newPeriodStart - 1);
  // Keep start <= end. Never leave end >= newPeriodStart (inclusive overlap).
  const startDate = Math.min(budget.startDate, endDate);
  return { startDate, endDate };
}

export function patchForReplacingBudget(
  budget: Pick<BudgetLike, 'startDate' | 'endDate'>,
  newPeriodStart: number,
  now: number = Date.now(),
): { status: 'ended'; startDate: number; endDate: number; updatedAt: number } {
  const bounds = boundsForCreateHandoffPrior(budget, newPeriodStart, now);
  return {
    status: 'ended',
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    updatedAt: now,
  };
}

/**
 * Same-calendar-day ended row that should be handoff-clipped to `newStart-1`.
 * - Overlaps new start, or
 * - Ended earlier today with an uncovered gap until newStart (Manual End then
 *   later Create) — but not if another non-archived period already covers the gap
 *   (avoids rewriting an earlier handoff when replacing a newer active).
 */
export function isSameDayCreateHandoffEnded(
  budget: Pick<BudgetLike, 'id' | 'status' | 'endDate'>,
  newPeriodStart: number,
  allBudgets?: Array<Pick<BudgetLike, 'id' | 'status' | 'startDate' | 'endDate'>>,
): boolean {
  if (budget.status !== 'ended') return false;
  if (
    formatLocalDateInput(new Date(budget.endDate)) !==
    formatLocalDateInput(new Date(newPeriodStart))
  ) {
    return false;
  }
  if (budget.endDate >= newPeriodStart) return true;
  const gapStart = budget.endDate + 1;
  const gapEnd = newPeriodStart - 1;
  if (gapStart > gapEnd) return false;
  if (!allBudgets) return true;
  return !allBudgets.some(b => {
    if (b.id === budget.id || b.status === 'archived') return false;
    return budgetRangesOverlap({ startDate: gapStart, endDate: gapEnd }, b);
  });
}

export function patchForCreateHandoffEnded(
  budget: Pick<BudgetLike, 'startDate' | 'endDate'>,
  newPeriodStart: number,
  now: number = Date.now(),
): { startDate: number; endDate: number; updatedAt: number } {
  const bounds = boundsForCreateHandoffPrior(budget, newPeriodStart, now);
  return {
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    updatedAt: now,
  };
}

/**
 * For create: simulate handoff against the incoming period start so overlap
 * checks match the write path — actives replaced, plus same-calendar-day ended
 * rows from Manual End. Does not mutate stored rows.
 */
export function budgetsWithActivesClippedForCreate<T extends BudgetLike>(
  budgets: T[],
  now: number = Date.now(),
  newPeriodStart?: number,
): T[] {
  return budgets.map(b => {
    if (b.status === 'active') {
      if (newPeriodStart != null) {
        const bounds = boundsForCreateHandoffPrior(b, newPeriodStart, now);
        return {
          ...b,
          status: 'ended' as const,
          startDate: bounds.startDate,
          endDate: bounds.endDate,
        };
      }
      return {
        ...b,
        status: 'ended' as const,
        endDate: clippedEndDateForEndedBudget(b, now),
      };
    }
    if (newPeriodStart != null && isSameDayCreateHandoffEnded(b, newPeriodStart, budgets)) {
      const bounds = boundsForCreateHandoffPrior(b, newPeriodStart, now);
      return {
        ...b,
        startDate: bounds.startDate,
        endDate: bounds.endDate,
      };
    }
    return b;
  });
}

/**
 * Continue must start after the source period ends (prior spend stays there).
 * If the parsed start would overlap the source, bump to source.endDate + 1.
 */
export function resolveContinuationBounds(
  source: Pick<BudgetLike, 'endDate'>,
  bounds: { startDate: number; endDate: number; periodLengthDays: number },
): { startDate: number; endDate: number; periodLengthDays: number } | { error: string } {
  let startDate = bounds.startDate;
  if (startDate <= source.endDate) {
    startDate = source.endDate + 1;
  }
  if (bounds.endDate < startDate) {
    return { error: 'End date must be after the previous period ends.' };
  }
  return {
    startDate,
    endDate: bounds.endDate,
    periodLengthDays: differenceInDays(bounds.endDate, startDate) + 1,
  };
}

export function overlapConflictMessage(otherName: string): string {
  return `Dates overlap "${otherName}". Choose a window that does not overlap another budget period.`;
}

/**
 * First local-midnight picker day strictly after an inclusive `conflictEndDate`.
 * Primitive used while jumping across conflicts — not a global recovery answer.
 */
export function earliestNonOverlappingPickerStartDateStr(conflictEndDate: number): string {
  const after = conflictEndDate + 1;
  const probe = new Date(after);
  let midnight = localMidnightMs(probe.getFullYear(), probe.getMonth(), probe.getDate());
  if (midnight <= conflictEndDate) {
    const next = addDays(new Date(midnight), 1);
    midnight = localMidnightMs(next.getFullYear(), next.getMonth(), next.getDate());
  }
  return formatLocalDateInput(new Date(midnight));
}

export function formatBudgetDayLabel(ms: number): string {
  return formatLocalDateInput(new Date(ms));
}

export type BudgetOverlapCheckMode = 'create' | 'plain';

/**
 * Budget list for overlap checks. Create matches submit: actives clipped with
 * `newPeriodStart`. Plain leaves rows as-is (edit/continue). Archived still
 * ignored by `findOverlappingBudget`. Never mutates stored rows.
 */
export function budgetsForOverlapCheck<T extends BudgetLike>(
  budgets: T[],
  checkMode: BudgetOverlapCheckMode,
  proposedStart: number,
  now: number = Date.now(),
): T[] {
  if (checkMode === 'create') {
    return budgetsWithActivesClippedForCreate(budgets, now, proposedStart);
  }
  return budgets;
}

export type BudgetOverlapRecoveryPlan =
  | {
      ok: true;
      earliestStartDateStr: string;
      conflictName: string;
      conflictEndDate: number;
      conflictEndDateStr: string;
      message: string;
    }
  | {
      ok: false;
      conflictName?: string;
      conflictEndDate?: number;
      conflictEndDateStr?: string;
      message: string;
    };

/**
 * Earliest picker start **≥ minStartDateStr** such that [start, endDateStr]
 * overlaps no relevant non-archived period under the same rules as submit.
 *
 * Strategy: jump past each conflict's end (not unbounded day scans). End date
 * is held fixed — if no start fits, returns ok:false (caller must not invent
 * an end or loop forever). Historical rows are never rewritten.
 */
function boundsForOverlapCandidate<T extends BudgetLike>(
  candidate: string,
  endDateStr: string,
  now: number,
  budgets: T[],
  checkMode: BudgetOverlapCheckMode,
): { startDate: number; endDate: number; periodLengthDays: number } | { error: string } {
  if (checkMode === 'create') {
    return resolveCreatePeriodBounds(
      candidate,
      endDateStr,
      now,
      isCreateHandoffContext(budgets, candidate, now),
    );
  }
  return parseBudgetDateBounds(candidate, endDateStr, now);
}

export function findEarliestNonOverlappingPickerStart<T extends BudgetLike>(args: {
  minStartDateStr: string;
  endDateStr: string;
  budgets: T[];
  checkMode: BudgetOverlapCheckMode;
  excludeId?: string;
  now?: number;
}): BudgetOverlapRecoveryPlan {
  const now = args.now ?? Date.now();
  const unavailable =
    'No valid start fits before the selected end date. Extend the end date or choose another window. Existing budget periods are not changed.';

  const seed = boundsForOverlapCandidate(
    args.minStartDateStr,
    args.endDateStr,
    now,
    args.budgets,
    args.checkMode,
  );
  if ('error' in seed) {
    return { ok: false, message: unavailable };
  }

  let candidate = args.minStartDateStr;
  let firstConflict: T | undefined;
  // Bounded by calendar span of the fixed end window (+ small slack for jumps).
  const maxSteps = Math.max(2, differenceInDays(seed.endDate, seed.startDate) + 4);

  for (let step = 0; step < maxSteps; step++) {
    const bounds = boundsForOverlapCandidate(
      candidate,
      args.endDateStr,
      now,
      args.budgets,
      args.checkMode,
    );
    if ('error' in bounds) {
      return {
        ok: false,
        conflictName: firstConflict?.name,
        conflictEndDate: firstConflict?.endDate,
        conflictEndDateStr: firstConflict ? formatBudgetDayLabel(firstConflict.endDate) : undefined,
        message: firstConflict
          ? `Dates overlap "${firstConflict.name}" and no later start fits before ${args.endDateStr}. Extend the end date or choose another window. Existing budget periods are not changed.`
          : unavailable,
      };
    }

    const pool = budgetsForOverlapCheck(args.budgets, args.checkMode, bounds.startDate, now);
    const conflict = findOverlappingBudget(bounds, pool, args.excludeId);
    if (!conflict) {
      if (!firstConflict) {
        return {
          ok: true,
          earliestStartDateStr: candidate,
          conflictName: '',
          conflictEndDate: 0,
          conflictEndDateStr: '',
          message: 'Selected dates do not overlap another budget period.',
        };
      }
      return {
        ok: true,
        earliestStartDateStr: candidate,
        conflictName: firstConflict.name,
        conflictEndDate: firstConflict.endDate,
        conflictEndDateStr: formatBudgetDayLabel(firstConflict.endDate),
        message:
          `Dates overlap "${firstConflict.name}" (that period ends ${formatBudgetDayLabel(firstConflict.endDate)}). ` +
          `Earliest start on or after ${args.minStartDateStr} that fits before ${args.endDateStr} ` +
          `without overlapping other periods is ${candidate}. Existing budget periods are not changed.`,
      };
    }

    if (!firstConflict) firstConflict = conflict;

    let next = earliestNonOverlappingPickerStartDateStr(conflict.endDate);
    if (next < args.minStartDateStr) next = args.minStartDateStr;
    if (next <= candidate) {
      const [y, m, d] = candidate.split('-').map(Number);
      next = formatLocalDateInput(addDays(new Date(y!, m! - 1, d!), 1));
    }

    const nextBounds = boundsForOverlapCandidate(
      next,
      args.endDateStr,
      now,
      args.budgets,
      args.checkMode,
    );
    if ('error' in nextBounds) {
      return {
        ok: false,
        conflictName: conflict.name,
        conflictEndDate: conflict.endDate,
        conflictEndDateStr: formatBudgetDayLabel(conflict.endDate),
        message:
          `Dates overlap "${conflict.name}" and no later start fits before ${args.endDateStr}. ` +
          `Extend the end date or choose another window. Existing budget periods are not changed.`,
      };
    }
    candidate = next;
  }

  return {
    ok: false,
    conflictName: firstConflict?.name,
    conflictEndDate: firstConflict?.endDate,
    conflictEndDateStr: firstConflict ? formatBudgetDayLabel(firstConflict.endDate) : undefined,
    message: unavailable,
  };
}

/** UI recovery payload — button only when `earliestStartDateStr` is set. */
export type BudgetOverlapConflictDetails = {
  conflictName: string;
  conflictEndDate: number;
  conflictEndDateStr: string;
  earliestStartDateStr: string | null;
  message: string;
};

/**
 * Build overlap message + multi-period-safe recovery plan for the fixed end date.
 * Does not mutate budgets. Single-conflict endDate alone is never treated as sufficient.
 */
export function describeBudgetOverlapConflict<T extends BudgetLike>(args: {
  minStartDateStr: string;
  endDateStr: string;
  budgets: T[];
  checkMode: BudgetOverlapCheckMode;
  excludeId?: string;
  now?: number;
  /** Optional first conflict from the failed check (for messaging fallback). */
  conflict?: Pick<BudgetLike, 'name' | 'endDate'>;
}): BudgetOverlapConflictDetails {
  const plan = findEarliestNonOverlappingPickerStart(args);
  if (plan.ok && plan.conflictName) {
    return {
      conflictName: plan.conflictName,
      conflictEndDate: plan.conflictEndDate,
      conflictEndDateStr: plan.conflictEndDateStr,
      earliestStartDateStr: plan.earliestStartDateStr,
      message: plan.message,
    };
  }
  if (!plan.ok) {
    return {
      conflictName: plan.conflictName || args.conflict?.name || '',
      conflictEndDate: plan.conflictEndDate || args.conflict?.endDate || 0,
      conflictEndDateStr:
        plan.conflictEndDateStr ||
        (args.conflict ? formatBudgetDayLabel(args.conflict.endDate) : ''),
      earliestStartDateStr: null,
      message: plan.message,
    };
  }
  // Window already free (no recovery action).
  return {
    conflictName: args.conflict?.name || '',
    conflictEndDate: args.conflict?.endDate || 0,
    conflictEndDateStr: args.conflict ? formatBudgetDayLabel(args.conflict.endDate) : '',
    earliestStartDateStr: null,
    message: plan.message,
  };
}

export type OverlapRecoveryClickResult =
  | {
      action: 'apply';
      startDateStr: string;
      /** True when fresher data changed the start vs the button's stale suggestion. */
      suggestionUpdated: boolean;
    }
  | {
      action: 'conflict';
      details: BudgetOverlapConflictDetails;
    }
  | {
      action: 'clear';
      message?: string;
    };

/**
 * Recovery click against an explicit budget list (caller should pass a fresh
 * Dexie read). Recomputes the plan — does not trust a stale button date —
 * using the same create-clip / overlap helpers as submit. Never mutates rows,
 * never submits; only returns the start to apply or an updated conflict UI.
 */
export function resolveOverlapRecoveryClick<T extends BudgetLike>(args: {
  latestBudgets: T[];
  startDateStr: string;
  endDateStr: string;
  checkMode: BudgetOverlapCheckMode;
  /** Suggestion shown on the button (may be stale vs `latestBudgets`). */
  staleSuggestedStartDateStr: string;
  excludeId?: string;
  now?: number;
}): OverlapRecoveryClickResult {
  const details = describeBudgetOverlapConflict({
    minStartDateStr: args.startDateStr,
    endDateStr: args.endDateStr,
    budgets: args.latestBudgets,
    checkMode: args.checkMode,
    excludeId: args.excludeId,
    now: args.now,
  });

  const now = args.now ?? Date.now();
  if (!details.earliestStartDateStr) {
    // No recoverable start against latest data (or window already free).
    const bounds = boundsForOverlapCandidate(
      args.startDateStr,
      args.endDateStr,
      now,
      args.latestBudgets,
      args.checkMode,
    );
    if (!('error' in bounds)) {
      const pool = budgetsForOverlapCheck(
        args.latestBudgets,
        args.checkMode,
        bounds.startDate,
        now,
      );
      const conflict = findOverlappingBudget(bounds, pool, args.excludeId);
      if (!conflict) {
        return { action: 'clear', message: details.message };
      }
    }
    return { action: 'conflict', details };
  }

  const nextStart = details.earliestStartDateStr;
  const bounds = boundsForOverlapCandidate(
    nextStart,
    args.endDateStr,
    now,
    args.latestBudgets,
    args.checkMode,
  );
  if ('error' in bounds) {
    return {
      action: 'conflict',
      details: {
        ...details,
        earliestStartDateStr: null,
        message: bounds.error,
      },
    };
  }

  const pool = budgetsForOverlapCheck(
    args.latestBudgets,
    args.checkMode,
    bounds.startDate,
    now,
  );
  const conflict = findOverlappingBudget(bounds, pool, args.excludeId);
  if (conflict) {
    const again = describeBudgetOverlapConflict({
      minStartDateStr: nextStart,
      endDateStr: args.endDateStr,
      budgets: args.latestBudgets,
      checkMode: args.checkMode,
      excludeId: args.excludeId,
      now,
      conflict,
    });
    return { action: 'conflict', details: again };
  }

  return {
    action: 'apply',
    startDateStr: nextStart,
    suggestionUpdated: nextStart !== args.staleSuggestedStartDateStr,
  };
}

/** Soft-restore archived → ended (never active; never changes id or dates). */
export function patchForRestoringArchivedBudget(
  now: number = Date.now(),
): { status: 'ended'; updatedAt: number } {
  return { status: 'ended', updatedAt: now };
}

/**
 * Restore is allowed when the archived window does not overlap any
 * non-archived budget. Does not overwrite ids or mutate transactions.
 */
export function canRestoreArchivedBudget<T extends BudgetLike>(
  archived: T,
  budgets: T[],
): { ok: true } | { ok: false; error: string } {
  if (archived.status !== 'archived') {
    return { ok: false, error: 'Only archived budgets can be restored.' };
  }
  const conflict = findOverlappingBudget(
    { startDate: archived.startDate, endDate: archived.endDate },
    budgets,
    archived.id,
  );
  if (conflict) {
    return {
      ok: false,
      error: `Cannot restore: dates overlap "${conflict.name}". Adjust or archive the conflicting period first.`,
    };
  }
  return { ok: true };
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

/** Natural period expiry: keep planned endDate so historical windows stay intact. */
export function patchForNaturalBudgetExpiry(
  now: number = Date.now(),
): { status: 'ended'; updatedAt: number } {
  return { status: 'ended', updatedAt: now };
}

/** Soft-remove from Ended/Active lists; transactions are never touched. */
export function patchForArchivingBudget(
  now: number = Date.now(),
): { status: 'archived'; updatedAt: number } {
  return { status: 'archived', updatedAt: now };
}

export function validateBudgetAmount(amount: unknown): { value: number } | { error: string } {
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(num) || num <= 0) {
    return { error: 'Amount must be greater than zero.' };
  }
  return { value: num };
}

/** Active budgets whose planned endDate has passed. */
export function activeBudgetIdsPastEnd<T extends BudgetLike>(
  budgets: T[],
  now: number = Date.now(),
): string[] {
  return budgets.filter(b => b.status === 'active' && b.endDate < now).map(b => b.id);
}

/**
 * True when a continuation row for this source already exists (any status).
 * Id is permanent — archived continuations are NOT reused, so historical
 * start/end/amount for that id cannot be overwritten by a later Continue.
 */
export function hasContinuationOf<T extends Pick<BudgetLike, 'id' | 'status'>>(
  fromBudgetId: string,
  budgets: T[],
): boolean {
  const contId = continuationBudgetId(fromBudgetId);
  return budgets.some(b => b.id === contId);
}

/**
 * Continue is allowed only when:
 * - source is ended
 * - no continuation id exists yet (including archived)
 * - there is no unrelated active budget (Continue must not clip/end another period)
 *
 * "+ New Budget" still ends actives deliberately; Continue does not.
 */
export function canContinueBudget<T extends BudgetLike>(
  source: T,
  budgets: T[],
): { ok: true } | { ok: false; error: string } {
  if (source.status !== 'ended') {
    return { ok: false, error: 'Only ended budgets can be continued.' };
  }
  if (hasContinuationOf(source.id, budgets)) {
    return {
      ok: false,
      error: 'This budget period was already continued. Start a new budget instead.',
    };
  }
  const active = resolveActiveBudget(budgets);
  if (active) {
    return {
      ok: false,
      error: 'End your current active budget before continuing an earlier period.',
    };
  }
  return { ok: true };
}

/**
 * Default dates for a continued period: start on the calendar day of
 * source.endDate+1 (so windows do not overlap), length from prior period.
 */
export function defaultContinuationDateStrings(
  source: Pick<BudgetLike, 'startDate' | 'endDate' | 'periodLength'>,
  now: number = Date.now(),
): { startDateStr: string; endDateStr: string; periodLengthDays: number } {
  const priorDays = Math.max(
    1,
    source.periodLength || differenceInDays(source.endDate, source.startDate) + 1,
  );
  const startMs = Math.max(source.endDate + 1, localMidnightMs(
    new Date(now).getFullYear(),
    new Date(now).getMonth(),
    new Date(now).getDate(),
  ));
  const start = new Date(startMs);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const end = addDays(startDay, priorDays - 1);
  return {
    startDateStr: formatLocalDateInput(startDay),
    endDateStr: formatLocalDateInput(end),
    periodLengthDays: priorDays,
  };
}

/**
 * Carry-forward math for Continue Budget (period-budget model).
 *
 * - Ended period keeps its original limit + date window → prior spend stays in history.
 * - New period `amount` = opening available for the *new* window only (default carry).
 * - New-period remaining = newAmount − spend(in new window). Prior spend is not
 *   re-applied to the new window (no double-count; transactions are not moved).
 * - Overspent / fully spent prior: carriedForward = 0; caller should require a
 *   fresh positive limit rather than silently resetting to the old limit.
 */
export type ContinuationCarryForward = {
  priorLimit: number;
  priorSpent: number;
  /** max(0, priorLimit − priorSpent); default opening amount for the new period */
  carriedForward: number;
  /** How much the prior period exceeded its limit (0 if not overspent) */
  overspentBy: number;
  /** True when nothing remains to carry — user must set a new positive limit */
  requiresNewLimit: boolean;
};

export function computeContinuationCarryForward(
  priorLimit: number,
  priorSpent: number,
): ContinuationCarryForward {
  const limit = Number.isFinite(priorLimit) ? Math.max(0, priorLimit) : 0;
  const spent = Number.isFinite(priorSpent) ? Math.max(0, priorSpent) : 0;
  const raw = limit - spent;
  if (raw > 0) {
    return {
      priorLimit: limit,
      priorSpent: spent,
      carriedForward: raw,
      overspentBy: 0,
      requiresNewLimit: false,
    };
  }
  return {
    priorLimit: limit,
    priorSpent: spent,
    carriedForward: 0,
    overspentBy: raw < 0 ? Math.abs(raw) : 0,
    requiresNewLimit: true,
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
