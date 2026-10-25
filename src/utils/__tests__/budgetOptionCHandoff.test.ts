/**
 * Option C: greenfield today = midnight; same-day replace/Manual End→Create = now.
 */
import {
  budgetRangesOverlap,
  budgetsWithActivesClippedForCreate,
  clippedEndDateForEndedBudget,
  isCreateHandoffContext,
  parseBudgetDateBounds,
  patchForCreateHandoffEnded,
  patchForReplacingBudget,
  resolveCreatePeriodBounds,
  findOverlappingBudget,
  type BudgetLike,
} from '../budgetLifecycle';
import { sumBudgetSpending, type SpendTxn } from '../spendingAmount';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type Txn = SpendTxn & { id: string };
function txn(partial: Partial<Txn> & Pick<Txn, 'id' | 'type' | 'amount' | 'date'>): Txn {
  return { excludeFromBudget: false, ...partial };
}

function runTests() {
  console.log('Running Option C handoff regression tests...');

  // Fixed local timeline: 2026-10-25
  const handoffAt = new Date(2026, 9, 25, 17, 22, 0, 0).getTime();
  const morning = new Date(2026, 9, 25, 9, 0, 0, 0).getTime();
  const afternoon = new Date(2026, 9, 25, 15, 0, 0, 0).getTime();
  const afterHandoff = new Date(2026, 9, 25, 18, 0, 0, 0).getTime();
  const todayMidnight = new Date(2026, 9, 25).getTime();
  const todayStr = '2026-10-25';
  const endStr = '2026-11-24';

  const dayPool: Txn[] = [
    txn({ id: 'am', type: 'expense', amount: 10, date: morning }),
    txn({ id: 'mid', type: 'expense', amount: 20, date: afternoon }),
    txn({ id: 'pm', type: 'expense', amount: 40, date: afterHandoff }),
  ];

  // 1) Brand-new today → midnight includes earlier today
  assertEqual(isCreateHandoffContext([], todayStr, handoffAt), false, 'Empty list is greenfield');
  const green = resolveCreatePeriodBounds(todayStr, endStr, handoffAt, false);
  assert(!('error' in green), 'greenfield bounds');
  if (!('error' in green)) {
    assertEqual(green.startDate, todayMidnight, 'Greenfield today starts at midnight');
    assertEqual(sumBudgetSpending(dayPool, green), 70, 'Greenfield includes all today expenses');
  }

  // 2–6) Same-day replacement at fixed timestamp
  const priorActive: BudgetLike = {
    id: 'old',
    name: 'Prior',
    status: 'active',
    startDate: new Date(2026, 9, 1).getTime(),
    endDate: new Date(2026, 9, 31, 23, 59, 59, 999).getTime(),
    amount: 10000,
    periodLength: 31,
    updatedAt: 1,
  };
  assert(isCreateHandoffContext([priorActive], todayStr, handoffAt), 'Active → handoff context');
  const replaceBounds = resolveCreatePeriodBounds(todayStr, endStr, handoffAt, true);
  assert(!('error' in replaceBounds), 'replace bounds');
  if ('error' in replaceBounds) return;
  assertEqual(replaceBounds.startDate, handoffAt, 'Replace today starts at handoff timestamp');

  const replacePatch = patchForReplacingBudget(priorActive, replaceBounds.startDate, handoffAt);
  assertEqual(replacePatch.endDate, handoffAt - 1, 'Old ends immediately before handoff');
  assert(replacePatch.endDate < replaceBounds.startDate, 'No gap: abutting inclusive windows');
  assertEqual(replacePatch.endDate + 1, replaceBounds.startDate, 'No timestamp gap at boundary');

  const oldWindow = { startDate: priorActive.startDate, endDate: replacePatch.endDate };
  const newWindow = { startDate: replaceBounds.startDate, endDate: replaceBounds.endDate };
  assert(!budgetRangesOverlap(oldWindow, newWindow), 'No inclusive overlap');
  assertEqual(sumBudgetSpending(dayPool, oldWindow), 30, 'Pre-handoff (am+mid) stay on old');
  assertEqual(sumBudgetSpending(dayPool, newWindow), 40, 'Post-handoff only on new');
  assertEqual(
    sumBudgetSpending(dayPool, oldWindow) + sumBudgetSpending(dayPool, newWindow),
    70,
    'Exactly-once across handoff',
  );

  const afterReplace = budgetsWithActivesClippedForCreate(
    [priorActive],
    handoffAt,
    replaceBounds.startDate,
  );
  assertEqual(
    findOverlappingBudget(replaceBounds, afterReplace),
    undefined,
    'Replace create allowed',
  );

  // 6) Manual End → Create same as replace
  const endedToday: BudgetLike = {
    ...priorActive,
    status: 'ended',
    endDate: clippedEndDateForEndedBudget(priorActive, handoffAt),
  };
  assertEqual(endedToday.endDate, handoffAt - 1, 'Manual End at handoff clock');
  assert(isCreateHandoffContext([endedToday], todayStr, handoffAt), 'Manual End today → handoff');
  const manualBounds = resolveCreatePeriodBounds(todayStr, endStr, handoffAt, true);
  assert(!('error' in manualBounds), 'manual create bounds');
  if (!('error' in manualBounds)) {
    assertEqual(manualBounds.startDate, handoffAt, 'Manual End→Create starts at handoff');
    const persist = patchForCreateHandoffEnded(endedToday, manualBounds.startDate, handoffAt);
    assertEqual(persist.endDate, handoffAt - 1, 'Same clip as replace');
    const sim = budgetsWithActivesClippedForCreate([endedToday], handoffAt, manualBounds.startDate);
    assertEqual(findOverlappingBudget(manualBounds, sim), undefined, 'Manual End→Create allowed');
    assertEqual(
      sumBudgetSpending(dayPool, { startDate: endedToday.startDate, endDate: persist.endDate }),
      30,
      'Manual End path keeps pre-handoff on old',
    );
    assertEqual(sumBudgetSpending(dayPool, manualBounds), 40, 'Manual End path new gets post only');
  }

  // Past-date start unchanged
  const past = parseBudgetDateBounds('2026-10-01', '2026-10-15', handoffAt);
  assert(!('error' in past), 'past parse');
  if (!('error' in past)) {
    assertEqual(past.startDate, new Date(2026, 9, 1).getTime(), 'Past start is midnight');
  }
  assertEqual(
    isCreateHandoffContext([priorActive], '2026-10-01', handoffAt),
    false,
    'Past start day is not handoff context',
  );

  console.log('All Option C handoff tests passed.');
}

runTests();
