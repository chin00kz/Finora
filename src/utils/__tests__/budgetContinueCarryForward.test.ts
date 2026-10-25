/**
 * Continue Budget carry-forward: 1000 / 100 / 900 case, new-period spend,
 * historical isolation, and overspend.
 */
import { computeContinuationCarryForward } from '../budgetLifecycle';
import {
  listBudgetCountedExpenses,
  sumBudgetSpending,
  type SpendTxn,
} from '../spendingAmount';

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
  console.log('Running budget continue carry-forward tests...');

  // Core case: limit 1000, spent 100 → carry 900
  const carry = computeContinuationCarryForward(1000, 100);
  assertEqual(carry.priorLimit, 1000, 'prior limit');
  assertEqual(carry.priorSpent, 100, 'prior spent');
  assertEqual(carry.carriedForward, 900, 'carried forward remaining');
  assertEqual(carry.overspentBy, 0, 'not overspent');
  assertEqual(carry.requiresNewLimit, false, 'can use carried amount');

  // Period isolation: ended window keeps the LKR 100; new window starts clean
  const endedRange = { startDate: 1_000, endDate: 2_000 };
  const newRange = { startDate: 3_000, endDate: 4_000 };
  const historyTxn = txn({ id: 'hist', type: 'expense', amount: 100, date: 1_500 });
  const newTxn = txn({ id: 'new', type: 'expense', amount: 50, date: 3_500 });
  const all = [historyTxn, newTxn];

  assertEqual(sumBudgetSpending(all, endedRange), 100, 'Ended period still shows LKR 100 spent');
  assertEqual(
    listBudgetCountedExpenses(all, endedRange).map(t => t.id).join(','),
    'hist',
    'Historical activity lists prior spend only',
  );
  assertEqual(sumBudgetSpending(all, newRange), 50, 'New period counts only new spend');

  // New period opening = 900; after LKR 50 spend → remaining 850
  const newOpening = carry.carriedForward;
  const newSpent = sumBudgetSpending(all, newRange);
  assertEqual(newOpening - newSpent, 850, 'New-period remaining after spend');

  // Prior LKR 100 must not reduce the new period a second time
  assertEqual(
    newOpening - newSpent,
    900 - 50,
    'No double-count of historical LKR 100 against new opening',
  );

  // Cumulative view across history (display-only math; not stored as one budget)
  const cumulativeSpent = sumBudgetSpending(all, endedRange) + sumBudgetSpending(all, newRange);
  assertEqual(cumulativeSpent, 150, 'Cumulative spend across continued history');

  // Fully spent → nothing to carry; require new limit
  const flat = computeContinuationCarryForward(1000, 1000);
  assertEqual(flat.carriedForward, 0, 'Fully spent carry 0');
  assertEqual(flat.requiresNewLimit, true, 'Fully spent requires new limit');
  assertEqual(flat.overspentBy, 0, 'Fully spent is not overspent');

  // Overspent: limit 1000, spent 1200 → carry 0, show deficit
  const over = computeContinuationCarryForward(1000, 1200);
  assertEqual(over.carriedForward, 0, 'Overspend carry 0');
  assertEqual(over.overspentBy, 200, 'Overspend by 200');
  assertEqual(over.requiresNewLimit, true, 'Overspend requires new limit');
  // Must not silently suggest resetting to original 1000
  assert(over.carriedForward !== 1000, 'Must not default carry to original limit when overspent');

  // Zero / empty spend
  const fresh = computeContinuationCarryForward(1000, 0);
  assertEqual(fresh.carriedForward, 1000, 'No spend → carry full limit');

  console.log('All budget continue carry-forward tests passed.');
}

runTests();
