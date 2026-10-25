/**
 * Stage 2 budget lifecycle / date / one-active regressions (pure).
 */
import {
  activeBudgetIdsToHeal,
  clippedEndDateForEndedBudget,
  formatLocalDateInput,
  inferBudgetStatus,
  isBudgetAnalyticsPeriod,
  parseBudgetDateBounds,
  resolveActiveBudget,
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

  // Today start uses now (not midnight) so earlier-today txns are excluded
  const noon = new Date(2024, 5, 15, 12, 0, 0, 0).getTime();
  const todayBounds = parseBudgetDateBounds('2024-06-15', '2024-06-30', noon);
  assert(!('error' in todayBounds), 'Today bounds parse ok');
  if (!('error' in todayBounds)) {
    assertEqual(todayBounds.startDate, noon, 'Today start = now');
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

  // Clip end for ended budget — no overlap with replacement at `now`
  const clip = clippedEndDateForEndedBudget(
    { startDate: noon - 7 * 86400000, endDate: noon + 10 * 86400000 },
    noon,
  );
  assertEqual(clip, noon - 1, 'Clip to now-1 prevents boundary overlap');

  // One-active resolver
  const budgets = [
    { id: 'a', status: 'active' as const, startDate: 100, endDate: 200, updatedAt: 1, amount: 1, name: 'A' },
    { id: 'b', status: 'active' as const, startDate: 150, endDate: 250, updatedAt: 2, amount: 1, name: 'B' },
    { id: 'c', status: 'ended' as const, startDate: 1, endDate: 2, updatedAt: 3, amount: 1, name: 'C' },
  ];
  assertEqual(resolveActiveBudget(budgets)?.id, 'b', 'Newest startDate wins');
  const heal = activeBudgetIdsToHeal(budgets);
  assertEqual(heal.keepId, 'b', 'Heal keeps newest');
  assertEqual(heal.endIds.join(','), 'a', 'Heal ends older active');

  // Analytics period gate
  assert(!isBudgetAnalyticsPeriod('current', false), 'current without active is not budget period');
  assert(isBudgetAnalyticsPeriod('current', true), 'current with active is budget period');
  assert(isBudgetAnalyticsPeriod('budget_x', false), 'past budget key is budget period');
  assert(!isBudgetAnalyticsPeriod('this_month', true), 'calendar month is general spend');

  // Missing status inference
  assertEqual(inferBudgetStatus(undefined, 1, noon - 1, noon), 'ended', 'Past window → ended');
  assertEqual(inferBudgetStatus('active', 1, noon + 1, noon), 'active', 'Explicit active kept');
  assertEqual(inferBudgetStatus('ended', 1, noon + 1, noon), 'ended', 'Explicit ended kept');

  // Pace status with period (BudgetDetail parity)
  const status = getBudgetStatus(100, 1000, {
    startDate: noon - 5 * 86400000,
    endDate: noon + 5 * 86400000,
  });
  assertEqual(status.isOverspent, false, 'Under budget');
  assert(status.paceState === 'on_track' || status.paceState === 'ahead_of_pace' || status.paceState === 'in_danger', 'Pace state set');

  const over = getBudgetStatus(1200, 1000);
  assertEqual(over.isOverspent, true, 'Overspent');
  assertEqual(over.label, 'overspent', 'Overspent label');

  console.log('All budget lifecycle tests passed.');
}

runTests();
