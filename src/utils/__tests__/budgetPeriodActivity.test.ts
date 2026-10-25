/**
 * Regression: budget period activity must list the same expenses that
 * `sumBudgetSpending` counts (active and ended windows).
 */
import {
  expensePersonalSpendAmount,
  listBudgetCountedExpenses,
  sumBudgetSpending,
  type SpendTxn,
} from '../spendingAmount';
import { parseBudgetDateBounds } from '../budgetLifecycle';

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
  return {
    excludeFromBudget: false,
    ...partial,
  };
}

function listSumConsistent(txns: Txn[], range: { startDate: number; endDate: number }, label: string) {
  const listed = listBudgetCountedExpenses(txns, range);
  const listedSum = listed.reduce((s, t) => s + expensePersonalSpendAmount(t), 0);
  const spent = sumBudgetSpending(txns, range);
  assertEqual(listedSum, spent, `${label}: list sum must equal sumBudgetSpending`);
  return listed;
}

function runTests() {
  console.log('Running budget period activity regression tests...');

  // Active-like window mid-period
  const activeRange = { startDate: 1_000, endDate: 2_000 };
  const activePool: Txn[] = [
    txn({ id: 'before', type: 'expense', amount: 50, date: 999 }),
    txn({ id: 'start', type: 'expense', amount: 100, date: 1_000 }),
    txn({ id: 'mid', type: 'expense', amount: 200, date: 1_500 }),
    txn({ id: 'end', type: 'expense', amount: 300, date: 2_000 }),
    txn({ id: 'after', type: 'expense', amount: 400, date: 2_001 }),
    txn({ id: 'oob', type: 'expense', amount: 999, date: 1_500, excludeFromBudget: true }),
    txn({ id: 'xfer', type: 'transfer', amount: 888, date: 1_500 }),
    txn({ id: 'income', type: 'income', amount: 777, date: 1_500 }),
    txn({ id: 'shared', type: 'expense', amount: 1000, date: 1_600, isShared: true, personalAmount: 250 }),
  ];

  const activeListed = listSumConsistent(activePool, activeRange, 'Active window');
  // Newest-first: end(2000), shared(1600), mid(1500), start(1000)
  assertEqual(
    activeListed.map(t => t.id).join(','),
    'end,shared,mid,start',
    'Active inclusion + newest-first order',
  );
  assertEqual(sumBudgetSpending(activePool, activeRange), 100 + 200 + 300 + 250, 'Active spent total');

  // Ended window (same rules)
  const endedRange = { startDate: 10_000, endDate: 10_500 };
  const endedPool: Txn[] = [
    txn({ id: 'e1', type: 'expense', amount: 10, date: 10_000 }),
    txn({ id: 'e2', type: 'expense', amount: 20, date: 10_250 }),
    txn({ id: 'e3', type: 'expense', amount: 30, date: 10_500 }),
    txn({ id: 'e4', type: 'expense', amount: 40, date: 10_501 }),
  ];
  const endedListed = listSumConsistent(endedPool, endedRange, 'Ended window');
  assertEqual(endedListed.map(t => t.id).join(','), 'e3,e2,e1', 'Ended inclusion order');
  assertEqual(sumBudgetSpending(endedPool, endedRange), 60, 'Ended spent total');

  // Today-start = local midnight: morning + afternoon both count
  const noon = new Date(2024, 5, 15, 12, 0, 0, 0).getTime();
  const morning = new Date(2024, 5, 15, 9, 0, 0, 0).getTime();
  const afternoon = new Date(2024, 5, 15, 15, 0, 0, 0).getTime();
  const bounds = parseBudgetDateBounds('2024-06-15', '2024-06-30', noon);
  assert(!('error' in bounds), 'bounds ok');
  if (!('error' in bounds)) {
    const dayPool: Txn[] = [
      txn({ id: 'am', type: 'expense', amount: 10, date: morning }),
      txn({ id: 'pm', type: 'expense', amount: 20, date: afternoon }),
    ];
    const listed = listSumConsistent(dayPool, bounds, 'Today-start window');
    assertEqual(listed.map(t => t.id).join(','), 'pm,am', 'Morning and afternoon both included');
    assertEqual(sumBudgetSpending(dayPool, bounds), 30, 'Full start-day spend counted');
  }

  // Date edit simulation: moving a txn into / out of the window refreshes inclusion
  const editRange = { startDate: 100, endDate: 200 };
  let editable: Txn[] = [
    txn({ id: 'move', type: 'expense', amount: 55, date: 50 }),
    txn({ id: 'keep', type: 'expense', amount: 10, date: 150 }),
  ];
  assertEqual(listBudgetCountedExpenses(editable, editRange).length, 1, 'Before edit: one in range');
  editable = editable.map(t => (t.id === 'move' ? { ...t, date: 120 } : t));
  assertEqual(listBudgetCountedExpenses(editable, editRange).length, 2, 'After date edit into range: two');
  assertEqual(sumBudgetSpending(editable, editRange), 65, 'Totals follow date edit');
  editable = editable.map(t => (t.id === 'move' ? { ...t, date: 250 } : t));
  assertEqual(listBudgetCountedExpenses(editable, editRange).length, 1, 'After date edit out of range: one');
  assertEqual(sumBudgetSpending(editable, editRange), 10, 'Totals drop when date leaves window');

  // No double-count: shared uses personalAmount once
  const sharedOnly = [
    txn({ id: 's', type: 'expense', amount: 5000, date: 150, isShared: true, personalAmount: 800 }),
  ];
  assertEqual(sumBudgetSpending(sharedOnly, editRange), 800, 'Shared personal share once');
  assertEqual(listBudgetCountedExpenses(sharedOnly, editRange).length, 1, 'Shared listed once');

  console.log('All budget period activity tests passed.');
}

runTests();
