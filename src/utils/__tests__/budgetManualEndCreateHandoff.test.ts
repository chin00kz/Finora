/**
 * Manual End today → Create starting today under Option C (handoff = now).
 */
import {
  budgetRangesOverlap,
  budgetsWithActivesClippedForCreate,
  canContinueBudget,
  clippedEndDateForEndedBudget,
  computeContinuationCarryForward,
  defaultContinuationDateStrings,
  findEarliestNonOverlappingPickerStart,
  findOverlappingBudget,
  isCreateHandoffContext,
  isSameDayCreateHandoffEnded,
  parseBudgetDateBounds,
  patchForCreateHandoffEnded,
  patchForReplacingBudget,
  resolveContinuationBounds,
  resolveCreatePeriodBounds,
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
  console.log('Running Manual End → Create Option C tests...');

  const noon = new Date(2024, 5, 15, 12, 0, 0, 0).getTime();
  const morning = new Date(2024, 5, 15, 9, 0, 0, 0).getTime();
  const afternoon = new Date(2024, 5, 15, 15, 0, 0, 0).getTime();

  const priorActive: BudgetLike = {
    id: 'main04',
    name: 'Main 04',
    status: 'active',
    startDate: new Date(2024, 5, 1).getTime(),
    endDate: new Date(2024, 5, 30, 23, 59, 59, 999).getTime(),
    amount: 10000,
    periodLength: 30,
    updatedAt: 1,
  };

  const endedToday: BudgetLike = {
    ...priorActive,
    status: 'ended',
    endDate: clippedEndDateForEndedBudget(priorActive, noon),
  };
  assertEqual(endedToday.endDate, noon - 1, 'Manual End clips to now-1');
  // ends at noon-1 already → abutting with create start=noon; gap-fill not required
  assertEqual(
    isSameDayCreateHandoffEnded(endedToday, noon, [endedToday]),
    false,
    'Abutting Manual End does not need re-clip',
  );
  assert(isCreateHandoffContext([endedToday], '2024-06-15', noon), 'Handoff context');

  const createBounds = resolveCreatePeriodBounds('2024-06-15', '2024-07-15', noon, true);
  assert(!('error' in createBounds), 'create today parses');
  if ('error' in createBounds) return;
  assertEqual(createBounds.startDate, noon, 'Create today handoff = now, not midnight');

  const afterHandoff = budgetsWithActivesClippedForCreate([endedToday], noon, createBounds.startDate);
  assertEqual(
    findOverlappingBudget(createBounds, afterHandoff),
    undefined,
    'Manual End → Create today: no overlap',
  );
  const persist = patchForCreateHandoffEnded(endedToday, createBounds.startDate, noon);
  assertEqual(persist.endDate, noon - 1, 'Persist end = handoff-1');

  const dayPool: Txn[] = [
    txn({ id: 'am', type: 'expense', amount: 10, date: morning }),
    txn({ id: 'pm', type: 'expense', amount: 20, date: afternoon }),
  ];
  const oldWindow = { startDate: endedToday.startDate, endDate: persist.endDate };
  const newWindow = { startDate: createBounds.startDate, endDate: createBounds.endDate };
  assert(!budgetRangesOverlap(oldWindow, newWindow), 'Abutting');
  assertEqual(sumBudgetSpending(dayPool, oldWindow), 10, 'Morning on old');
  assertEqual(sumBudgetSpending(dayPool, newWindow), 20, 'Afternoon on new');

  // + New replace
  const replacePatch = patchForReplacingBudget(priorActive, noon, noon);
  assertEqual(replacePatch.endDate, noon - 1, '+ New replace clip');
  assertEqual(
    findOverlappingBudget(
      createBounds,
      budgetsWithActivesClippedForCreate([priorActive], noon, noon),
    ),
    undefined,
    '+ New allowed',
  );

  // Other-day overlap still rejected
  const future: BudgetLike = {
    id: 'trip',
    name: 'Trip',
    status: 'ended',
    startDate: new Date(2024, 5, 16).getTime(),
    endDate: new Date(2024, 5, 20, 23, 59, 59, 999).getTime(),
    amount: 500,
    periodLength: 5,
    updatedAt: 2,
  };
  assertEqual(
    findOverlappingBudget(
      createBounds,
      budgetsWithActivesClippedForCreate([endedToday, future], noon, noon),
    )?.id,
    'trip',
    'Other-day overlap rejected',
  );

  const hist: BudgetLike = {
    id: 'hist',
    name: 'May',
    status: 'ended',
    startDate: new Date(2024, 4, 1).getTime(),
    endDate: new Date(2024, 4, 31, 23, 59, 59, 999).getTime(),
    amount: 800,
    periodLength: 31,
    updatedAt: 1,
  };
  const histEnd = hist.endDate;
  const withHist = budgetsWithActivesClippedForCreate([endedToday, hist], noon, noon);
  assertEqual(withHist.find(b => b.id === 'hist')?.endDate, histEnd, 'Unrelated ended unchanged');

  // Continue + carry
  const sourceAfter: BudgetLike = { ...endedToday, endDate: persist.endDate };
  const contBase = parseBudgetDateBounds('2024-06-15', '2024-06-28', noon);
  assert(!('error' in contBase), 'continue parse');
  if (!('error' in contBase)) {
    const cont = resolveContinuationBounds(sourceAfter, contBase);
    assert(!('error' in cont), 'continue bounds');
    if (!('error' in cont)) {
      assertEqual(cont.startDate, persist.endDate + 1, 'Continue after source end');
    }
  }
  const endedYesterday: BudgetLike = {
    id: 'y',
    name: 'Prior',
    status: 'ended',
    startDate: noon - 20 * 86400000,
    endDate: noon - 86400000,
    amount: 1000,
    periodLength: 14,
    updatedAt: 1,
  };
  assert(canContinueBudget(endedYesterday, [endedYesterday]).ok, 'Can continue');
  assertEqual(defaultContinuationDateStrings(endedYesterday, noon).periodLengthDays, 14, 'Length');
  assertEqual(computeContinuationCarryForward(1000, 100).carriedForward, 900, 'Carry');

  const planSolo = findEarliestNonOverlappingPickerStart({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-07-15',
    budgets: [endedToday],
    checkMode: 'create',
    now: noon,
  });
  assert(planSolo.ok, 'solo plan ok');
  if (planSolo.ok) {
    assertEqual(planSolo.earliestStartDateStr, '2024-06-15', 'Today valid under handoff=now');
  }

  console.log('All Manual End → Create Option C tests passed.');
}

runTests();
