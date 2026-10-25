/**
 * Reported case under Option C: "Test Dubplicate" same-day replace/Manual End→Create
 * uses handoff timestamp, not midnight.
 */
import {
  budgetRangesOverlap,
  budgetsWithActivesClippedForCreate,
  findOverlappingBudget,
  isCreateHandoffContext,
  isSameDayCreateHandoffEnded,
  patchForCreateHandoffEnded,
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
  console.log('Running Test Dubplicate Option C regression...');

  const handoffAt = new Date(2026, 9, 25, 17, 22, 0, 0).getTime();
  const morning = new Date(2026, 9, 25, 9, 0, 0, 0).getTime();
  const afternoon = new Date(2026, 9, 25, 15, 0, 0, 0).getTime();
  const after = new Date(2026, 9, 25, 18, 0, 0, 0).getTime();

  const testDubplicate: BudgetLike = {
    id: 'bud-dup',
    name: 'Test Dubplicate',
    status: 'ended',
    startDate: new Date(2026, 9, 1).getTime(),
    endDate: handoffAt - 1,
    amount: 5000,
    periodLength: 30,
    updatedAt: handoffAt,
  };

  assert(isCreateHandoffContext([testDubplicate], '2026-10-25', handoffAt), 'Handoff context');
  // Already ends at handoff-1 → abutting; no further clip needed
  assertEqual(
    isSameDayCreateHandoffEnded(testDubplicate, handoffAt, [testDubplicate]),
    false,
    'Abutting Manual End does not need re-clip',
  );

  const createBounds = resolveCreatePeriodBounds('2026-10-25', '2026-11-24', handoffAt, true);
  assert(!('error' in createBounds), 'create bounds');
  if ('error' in createBounds) return;
  assertEqual(createBounds.startDate, handoffAt, 'Starts at handoff 17:22, not midnight');

  const afterClip = budgetsWithActivesClippedForCreate(
    [testDubplicate],
    handoffAt,
    createBounds.startDate,
  );
  assertEqual(
    findOverlappingBudget(createBounds, afterClip),
    undefined,
    'Create starting same day succeeds',
  );

  const persist = patchForCreateHandoffEnded(testDubplicate, createBounds.startDate, handoffAt);
  assertEqual(persist.endDate, handoffAt - 1, 'Old ends at handoff-1');

  const dayPool: Txn[] = [
    txn({ id: 'am', type: 'expense', amount: 10, date: morning }),
    txn({ id: 'mid', type: 'expense', amount: 20, date: afternoon }),
    txn({ id: 'pm', type: 'expense', amount: 40, date: after }),
  ];
  const oldWindow = { startDate: persist.startDate, endDate: persist.endDate };
  const newWindow = { startDate: createBounds.startDate, endDate: createBounds.endDate };
  assert(!budgetRangesOverlap(oldWindow, newWindow), 'No overlap');
  assertEqual(sumBudgetSpending(dayPool, oldWindow), 30, 'Pre-handoff on old');
  assertEqual(sumBudgetSpending(dayPool, newWindow), 40, 'Post-handoff on new');

  console.log('All Test Dubplicate Option C tests passed.');
}

runTests();
