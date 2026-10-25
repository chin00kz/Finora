import { computeBulkDeleteBalanceDeltas } from '../bulkDeleteBalanceReversal';

function assertEqual(actual: number | undefined, expected: number, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function runTests() {
  console.log('Running bulk-delete transfer balance reversal regression tests...');

  // Scenario 1: Single transfer A -> B of 100
  // Create: A -= 100, B += 100. Delete must restore both sides.
  let deltas = computeBulkDeleteBalanceDeltas([
    {
      type: 'transfer',
      amount: 100,
      accountId: 'A',
      toAccountId: 'B',
    },
  ]);
  assertEqual(deltas.get('A'), 100, 'Transfer delete must credit source account');
  assertEqual(deltas.get('B'), -100, 'Transfer delete must debit destination account');
  console.log('✓ Scenario 1 passed: single transfer restores source and destination.');

  // Scenario 2: Two transfers affecting the same accounts
  // A -> B 50, then B -> A 20. Net delete reversal: A += 30, B -= 30.
  deltas = computeBulkDeleteBalanceDeltas([
    { type: 'transfer', amount: 50, accountId: 'A', toAccountId: 'B' },
    { type: 'transfer', amount: 20, accountId: 'B', toAccountId: 'A' },
  ]);
  assertEqual(deltas.get('A'), 30, 'Net source/dest overlap on A must accumulate');
  assertEqual(deltas.get('B'), -30, 'Net source/dest overlap on B must accumulate');
  console.log('✓ Scenario 2 passed: multiple transfers net correctly across shared accounts.');

  // Scenario 3: Existing expense / income / debt_settlement behavior preserved
  deltas = computeBulkDeleteBalanceDeltas([
    { type: 'expense', amount: 40, accountId: 'A' },
    { type: 'income', amount: 15, accountId: 'A' },
    { type: 'debt_settlement', amount: 10, accountId: 'A', debtDirection: 'theyOweMe' },
    { type: 'debt_settlement', amount: 5, accountId: 'B', debtDirection: 'iOweThem' },
  ]);
  // expense +40, income -15, theyOweMe settlement -10 => +15 on A
  assertEqual(deltas.get('A'), 15, 'Expense/income/theyOweMe settlement deltas must match prior behavior');
  // iOweThem settlement +5 on B
  assertEqual(deltas.get('B'), 5, 'iOweThem settlement delta must match prior behavior');
  console.log('✓ Scenario 3 passed: expense/income/debt_settlement deltas unchanged.');

  console.log('All bulk-delete balance reversal tests passed.');
}

runTests();
