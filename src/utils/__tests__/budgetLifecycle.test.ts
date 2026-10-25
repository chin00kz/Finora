/**
 * Stage 2 budget lifecycle / date / one-active / continue regressions (pure).
 */
import {
  activeBudgetIdsPastEnd,
  activeBudgetIdsToHeal,
  canContinueBudget,
  clippedEndDateForEndedBudget,
  continuationBudgetId,
  defaultContinuationDateStrings,
  formatLocalDateInput,
  hasContinuationOf,
  inferBudgetStatus,
  isBudgetAnalyticsPeriod,
  parseBudgetDateBounds,
  patchForArchivingBudget,
  patchForNaturalBudgetExpiry,
  resolveActiveBudget,
  validateBudgetAmount,
  type BudgetLike,
} from '../budgetLifecycle';
import { getBudgetStatus } from '../budgetUtils';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function runTests() {
  console.log('Running budget lifecycle regression tests...');

  // Local date formatting
  assertEqual(formatLocalDateInput(new Date(2024, 0, 5)), '2024-01-05', 'Local YYYY-MM-DD');

  // Today start uses local midnight so earlier-today expenses are included
  const noon = new Date(2024, 5, 15, 12, 0, 0, 0).getTime();
  const todayMidnight = new Date(2024, 5, 15).getTime();
  const todayBounds = parseBudgetDateBounds('2024-06-15', '2024-06-30', noon);
  assert(!('error' in todayBounds), 'Today bounds parse ok');
  if (!('error' in todayBounds)) {
    assertEqual(todayBounds.startDate, todayMidnight, 'Today start = local midnight');
    const endDay = new Date(todayBounds.endDate);
    assertEqual(endDay.getHours(), 23, 'End is local end-of-day hour');
    assertEqual(endDay.getMinutes(), 59, 'End is local end-of-day minute');
    assert(todayBounds.periodLengthDays >= 1, 'period length positive');
  }

  // Past start stays at local midnight
  const pastBounds = parseBudgetDateBounds('2024-06-01', '2024-06-10', noon);
  assert(!('error' in pastBounds), 'Past bounds parse ok');
  if (!('error' in pastBounds)) {
    assertEqual(
      pastBounds.startDate,
      new Date(2024, 5, 1).getTime(),
      'Past start is local midnight',
    );
  }

  // Invalid range
  const bad = parseBudgetDateBounds('2024-06-20', '2024-06-10', noon);
  assert('error' in bad, 'End before start rejected');

  // Amount validation
  assert('error' in validateBudgetAmount(0), 'Zero amount rejected');
  assert('error' in validateBudgetAmount(-5), 'Negative amount rejected');
  assert('error' in validateBudgetAmount('abc'), 'NaN amount rejected');
  const okAmt = validateBudgetAmount('100.5');
  assert(!('error' in okAmt) && okAmt.value === 100.5, 'Valid amount accepted');

  // Clip end for ended budget — no overlap with replacement at `now`
  const clip = clippedEndDateForEndedBudget(
    { startDate: noon - 7 * 86400000, endDate: noon + 10 * 86400000 },
    noon,
  );
  assertEqual(clip, noon - 1, 'Clip to now-1 prevents boundary overlap');

  // Natural expiry keeps planned endDate (patch has no endDate field)
  const nat = patchForNaturalBudgetExpiry(noon);
  assertEqual(nat.status, 'ended', 'Natural expiry → ended');
  assertEqual(nat.updatedAt, noon, 'Natural expiry stamps updatedAt');
  assert(!('endDate' in nat), 'Natural expiry does not rewrite endDate');

  // Archive soft-delete
  const arch = patchForArchivingBudget(noon);
  assertEqual(arch.status, 'archived', 'Archive status');

  // One-active resolver
  const budgets = [
    { id: 'a', status: 'active' as const, startDate: 100, endDate: 200, updatedAt: 1, amount: 1, name: 'A', periodLength: 30 },
    { id: 'b', status: 'active' as const, startDate: 150, endDate: 250, updatedAt: 2, amount: 1, name: 'B', periodLength: 30 },
    { id: 'c', status: 'ended' as const, startDate: 1, endDate: 2, updatedAt: 3, amount: 1, name: 'C', periodLength: 10 },
  ];
  assertEqual(resolveActiveBudget(budgets)?.id, 'b', 'Newest startDate wins');
  const heal = activeBudgetIdsToHeal(budgets);
  assertEqual(heal.keepId, 'b', 'Heal keeps newest');
  assertEqual(heal.endIds.join(','), 'a', 'Heal ends older active');

  // Past-end expiry detection
  const expired = activeBudgetIdsPastEnd(
    [
      { id: 'live', status: 'active' as const, startDate: noon - 10, endDate: noon + 10, updatedAt: 1, amount: 1, name: 'L', periodLength: 1 },
      { id: 'past', status: 'active' as const, startDate: noon - 20, endDate: noon - 1, updatedAt: 1, amount: 1, name: 'P', periodLength: 1 },
      { id: 'ended', status: 'ended' as const, startDate: 1, endDate: 2, updatedAt: 1, amount: 1, name: 'E', periodLength: 1 },
    ],
    noon,
  );
  assertEqual(expired.join(','), 'past', 'Only past-end actives expire');

  // Analytics period gate
  assert(!isBudgetAnalyticsPeriod('current', false), 'current without active is not budget period');
  assert(isBudgetAnalyticsPeriod('current', true), 'current with active is budget period');
  assert(isBudgetAnalyticsPeriod('budget_x', false), 'past budget key is budget period');
  assert(!isBudgetAnalyticsPeriod('this_month', true), 'calendar month is general spend');

  // Missing status inference
  assertEqual(inferBudgetStatus(undefined, 1, noon - 1, noon), 'ended', 'Past window → ended');
  assertEqual(inferBudgetStatus('active', 1, noon + 1, noon), 'active', 'Explicit active kept');
  assertEqual(inferBudgetStatus('ended', 1, noon + 1, noon), 'ended', 'Explicit ended kept');
  assertEqual(inferBudgetStatus('archived', 1, noon + 1, noon), 'archived', 'Explicit archived kept');

  // Continuation id + duplicate guard
  const source: BudgetLike = {
    id: 'bud-1',
    status: 'ended',
    startDate: noon - 10 * 86400000,
    endDate: noon - 86400000,
    updatedAt: 1,
    amount: 5000,
    name: 'June',
    periodLength: 14,
  };
  assertEqual(continuationBudgetId(source.id), 'bud-cont-bud-1', 'Deterministic continuation id');
  assertEqual(canContinueBudget(source, [source]).ok, true, 'Ended source can continue when idle');
  const activeSource: BudgetLike = { ...source, status: 'active' };
  assert(!canContinueBudget(activeSource, [source]).ok, 'Active cannot continue');

  // Unrelated active must not be terminated by Continue
  const unrelatedActive: BudgetLike = {
    id: 'bud-other',
    status: 'active',
    startDate: noon,
    endDate: noon + 30 * 86400000,
    updatedAt: 9,
    amount: 9000,
    name: 'Other',
    periodLength: 30,
  };
  assert(
    !canContinueBudget(source, [source, unrelatedActive]).ok,
    'Continue blocked while unrelated active exists',
  );

  const contId = continuationBudgetId(source.id);
  const withCont: BudgetLike[] = [
    source,
    {
      id: contId,
      status: 'active',
      startDate: noon,
      endDate: noon + 14 * 86400000,
      updatedAt: 2,
      amount: 5000,
      name: 'June',
      periodLength: 14,
    },
  ];
  assert(hasContinuationOf(source.id, withCont), 'Continuation detected');
  assert(!canContinueBudget(source, withCont).ok, 'Duplicate continue blocked');
  const withArchivedCont: BudgetLike[] = [
    source,
    {
      id: contId,
      status: 'archived',
      startDate: noon,
      endDate: noon + 14 * 86400000,
      updatedAt: 2,
      amount: 5000,
      name: 'June',
      periodLength: 14,
    },
  ];
  assert(hasContinuationOf(source.id, withArchivedCont), 'Archived continuation still occupies id');
  assert(
    !canContinueBudget(source, withArchivedCont).ok,
    'Archived continuation must not be reused/overwritten',
  );

  const dates = defaultContinuationDateStrings(source, noon);
  assertEqual(dates.periodLengthDays, 14, 'Continuation inherits periodLength');
  assertEqual(dates.startDateStr, formatLocalDateInput(new Date(noon)), 'Continuation starts today');

  // Pace status with period (BudgetDetail parity)
  const status = getBudgetStatus(100, 1000, {
    startDate: noon - 5 * 86400000,
    endDate: noon + 5 * 86400000,
  });
  assertEqual(status.isOverspent, false, 'Under budget');
  assert(
    status.paceState === 'on_track' ||
      status.paceState === 'ahead_of_pace' ||
      status.paceState === 'in_danger',
    'Pace state set',
  );

  const over = getBudgetStatus(1200, 1000);
  assertEqual(over.isOverspent, true, 'Overspent');
  assertEqual(over.label, 'overspent', 'Overspent label');
  assertEqual(over.actualPercent, 120, 'Unclamped percent');

  console.log('All budget lifecycle tests passed.');
}

runTests();
