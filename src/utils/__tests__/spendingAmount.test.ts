import {
  csvYourShareValue,
  expensePersonalSpendAmount,
  sumBudgetSpending,
  sumGeneralExpenseSpending,
} from '../spendingAmount';
import type { SpendTxn } from '../spendingAmount';
import { getTransactionBaseline } from '../glanceIntelligence';
import type { Transaction } from '../../db/db';

function assertEqual(actual: number, expected: number, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function txn(partial: Partial<SpendTxn> & Pick<SpendTxn, 'type' | 'amount'>): SpendTxn {
  return {
    date: 1_700_000_000_000,
    excludeFromBudget: false,
    ...partial,
  };
}

function runTests() {
  console.log('Running spending-amount regression tests...');

  // Zero personal share
  assertEqual(
    expensePersonalSpendAmount(
      txn({ type: 'expense', amount: 5000, isShared: true, personalAmount: 0 }),
    ),
    0,
    'Shared expense with personalAmount 0 must count as zero',
  );

  // Normal expense
  assertEqual(
    expensePersonalSpendAmount(txn({ type: 'expense', amount: 1200 })),
    1200,
    'Normal expense uses full amount',
  );

  // Shared expense with positive share
  assertEqual(
    expensePersonalSpendAmount(
      txn({ type: 'expense', amount: 5000, isShared: true, personalAmount: 2000 }),
    ),
    2000,
    'Shared expense uses personal share',
  );

  // Transfers / balance history never count
  assertEqual(
    expensePersonalSpendAmount(txn({ type: 'transfer', amount: 900 })),
    0,
    'Transfer must not count as expense spend',
  );
  assertEqual(
    expensePersonalSpendAmount(txn({ type: 'opening_balance', amount: 5000 })),
    0,
    'Opening balance must not count as expense spend',
  );
  assertEqual(
    expensePersonalSpendAmount(txn({ type: 'balance_adjustment', amount: -200 })),
    0,
    'Balance adjustment must not count as expense spend',
  );
  assertEqual(
    expensePersonalSpendAmount(txn({ type: 'income', amount: 900 })),
    0,
    'Income must not count as expense spend',
  );

  const mix: SpendTxn[] = [
    txn({ type: 'expense', amount: 1000 }),
    txn({ type: 'expense', amount: 5000, isShared: true, personalAmount: 0 }),
    txn({ type: 'expense', amount: 3000, isShared: true, personalAmount: 1000 }),
    txn({ type: 'expense', amount: 400, excludeFromBudget: true }),
    txn({ type: 'transfer', amount: 2500 }),
    txn({ type: 'income', amount: 8000 }),
  ];

  // Budget spending: excludes out-of-budget; zero share; no transfers
  assertEqual(
    sumBudgetSpending(mix),
    2000, // 1000 + 0 + 1000
    'Budget sum must exclude excludeFromBudget and ignore transfers/income',
  );

  // General spending: includes out-of-budget; still personal share / zero share
  assertEqual(
    sumGeneralExpenseSpending(mix),
    2400, // 1000 + 0 + 1000 + 400
    'General sum includes excludeFromBudget but not transfers',
  );

  // Date range for budgets
  assertEqual(
    sumBudgetSpending(
      [
        txn({ type: 'expense', amount: 100, date: 100 }),
        txn({ type: 'expense', amount: 200, date: 200 }),
        txn({ type: 'expense', amount: 300, date: 300 }),
      ],
      { startDate: 150, endDate: 250 },
    ),
    200,
    'Budget sum respects date range',
  );

  // CSV Your Share column: shared only (incl. 0); blank otherwise; Amount stays full cash
  if (csvYourShareValue(txn({ type: 'expense', amount: 5000, isShared: true, personalAmount: 0 })) !== '0') {
    throw new Error('CSV Your Share must export 0 for zero personal share');
  }
  if (csvYourShareValue(txn({ type: 'expense', amount: 5000, isShared: true, personalAmount: 2000 })) !== '2000') {
    throw new Error('CSV Your Share must export personal share for shared expenses');
  }
  if (csvYourShareValue(txn({ type: 'expense', amount: 1200 })) !== '') {
    throw new Error('CSV Your Share must be empty for non-shared expenses');
  }
  if (csvYourShareValue(txn({ type: 'transfer', amount: 900 })) !== '') {
    throw new Error('CSV Your Share must be empty for transfers');
  }
  // Legacy: personalAmount without isShared → ignore personalAmount
  assertEqual(
    expensePersonalSpendAmount(
      txn({ type: 'expense', amount: 5000, isShared: false, personalAmount: 2000 }),
    ),
    5000,
    'Without isShared, personalAmount must not apply',
  );
  if (csvYourShareValue(txn({ type: 'expense', amount: 5000, isShared: false, personalAmount: 2000 })) !== '') {
    throw new Error('CSV Your Share must be empty when isShared is false');
  }

  // Glance baseline: personal share, includes out-of-budget, ignores transfers
  const now = Date.now();
  const glanceTxns = [
    { id: '1', type: 'expense', amount: 1000, date: now, accountId: 'a' },
    { id: '2', type: 'expense', amount: 5000, date: now, accountId: 'a', isShared: true, personalAmount: 1000 },
    { id: '3', type: 'expense', amount: 1000, date: now, accountId: 'a', excludeFromBudget: true },
    { id: '4', type: 'expense', amount: 5000, date: now, accountId: 'a', isShared: true, personalAmount: 0 },
    { id: '5', type: 'expense', amount: 1000, date: now, accountId: 'a' },
    { id: '6', type: 'transfer', amount: 99999, date: now, accountId: 'a', toAccountId: 'b' },
  ] as Transaction[];
  const baseline = getTransactionBaseline(glanceTxns);
  // Personal spends: 1000, 1000, 1000, 0, 1000 → median 1000 (not 5000 full bills)
  assertEqual(baseline ?? -1, 1000, 'Glance baseline must use personal share and include out-of-budget');

  console.log('✓ Zero share, normal, shared, excluded, transfers, CSV, and glance cases passed.');
  console.log('All spending-amount tests passed.');
}

runTests();

