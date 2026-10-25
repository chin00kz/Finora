import {
  computeApplyBalanceDeltas,
  computeReverseBalanceDeltas,
  requiredAccountIdsForApply,
  validateAccountsForApply,
} from '../accountBalanceEffects';
import { computeBulkDeleteBalanceDeltas } from '../bulkDeleteBalanceReversal';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function mapGet(m: Map<string, number>, id: string): number {
  return m.get(id) ?? 0;
}

function runTests() {
  console.log('Running account balance effects regression tests...');

  // --- Validation: missing accounts / invalid transfer ---
  assertEqual(
    validateAccountsForApply({ type: 'expense', amount: 100, accountId: '' }),
    'Account is required.',
    'Expense without account must fail validation',
  );
  assertEqual(
    validateAccountsForApply({ type: 'transfer', amount: 100, accountId: 'A', toAccountId: '' }),
    'Destination account is required.',
    'Transfer without destination must fail validation',
  );
  assertEqual(
    validateAccountsForApply({ type: 'transfer', amount: 100, accountId: 'A', toAccountId: 'A' }),
    'Source and destination accounts must be different.',
    'Transfer to same account must fail validation',
  );
  assertEqual(
    validateAccountsForApply({ type: 'transfer', amount: 100, accountId: 'A', toAccountId: 'B' }),
    null,
    'Valid transfer must pass validation',
  );
  assertEqual(
    requiredAccountIdsForApply({ type: 'transfer', amount: 50, accountId: 'A', toAccountId: 'B' }).join(','),
    'A,B',
    'Transfer apply requires both account IDs',
  );
  console.log('✓ Validation: missing/invalid accounts rejected.');

  // --- Apply: expense / income / transfer ---
  let apply = computeApplyBalanceDeltas({ type: 'expense', amount: 200, accountId: 'A' });
  assertEqual(mapGet(apply, 'A'), -200, 'Expense apply debits source');

  apply = computeApplyBalanceDeltas({ type: 'income', amount: 150, accountId: 'A' });
  assertEqual(mapGet(apply, 'A'), 150, 'Income apply credits source');

  apply = computeApplyBalanceDeltas({
    type: 'transfer',
    amount: 80,
    accountId: 'A',
    toAccountId: 'B',
  });
  assertEqual(mapGet(apply, 'A'), -80, 'Transfer apply debits source once');
  assertEqual(mapGet(apply, 'B'), 80, 'Transfer apply credits destination once');
  assertEqual(apply.size, 2, 'Transfer apply touches exactly two accounts');
  console.log('✓ Apply deltas: expense, income, transfer.');

  // --- Reverse: transfer both sides even when used for delete ---
  const reverse = computeReverseBalanceDeltas({
    type: 'transfer',
    amount: 80,
    accountId: 'A',
    toAccountId: 'B',
  });
  assertEqual(mapGet(reverse, 'A'), 80, 'Transfer reverse credits source');
  assertEqual(mapGet(reverse, 'B'), -80, 'Transfer reverse debits destination');

  // Reverse of apply is identity net-zero when both applied
  for (const [id, d] of apply) {
    assertEqual(mapGet(reverse, id), -d, `Reverse must negate apply for ${id}`);
  }
  console.log('✓ Reverse deltas: transfer both sides; negate apply.');

  // --- Debt settlement ---
  const dsApply = computeApplyBalanceDeltas({
    type: 'debt_settlement',
    amount: 40,
    accountId: 'A',
    debtDirection: 'theyOweMe',
  });
  assertEqual(mapGet(dsApply, 'A'), 40, 'theyOweMe settlement credits account');
  const dsReverse = computeReverseBalanceDeltas({
    type: 'debt_settlement',
    amount: 40,
    accountId: 'A',
    debtDirection: 'theyOweMe',
  });
  assertEqual(mapGet(dsReverse, 'A'), -40, 'theyOweMe settlement reverse debits');
  console.log('✓ Debt settlement apply/reverse.');

  // --- Opening balance / balance adjustment (signed, no double-count on reverse) ---
  assertEqual(
    validateAccountsForApply({ type: 'opening_balance', amount: 0, accountId: 'A' }),
    'Amount must be non-zero.',
    'Opening balance zero must fail',
  );
  assertEqual(
    validateAccountsForApply({ type: 'balance_adjustment', amount: -250, accountId: 'A' }),
    null,
    'Negative adjustment must be allowed',
  );
  const obApply = computeApplyBalanceDeltas({
    type: 'opening_balance',
    amount: 1000,
    accountId: 'A',
  });
  assertEqual(mapGet(obApply, 'A'), 1000, 'Opening apply credits signed amount once');
  const obReverse = computeReverseBalanceDeltas({
    type: 'opening_balance',
    amount: 1000,
    accountId: 'A',
  });
  assertEqual(mapGet(obReverse, 'A'), -1000, 'Opening reverse removes the same credit');

  const adjApply = computeApplyBalanceDeltas({
    type: 'balance_adjustment',
    amount: -250,
    accountId: 'A',
  });
  assertEqual(mapGet(adjApply, 'A'), -250, 'Adjustment apply uses signed delta');
  const adjReverse = computeReverseBalanceDeltas({
    type: 'balance_adjustment',
    amount: -250,
    accountId: 'A',
  });
  assertEqual(mapGet(adjReverse, 'A'), 250, 'Adjustment reverse negates signed delta');
  // Simulate create: start 0 + opening 1000 = 1000 (not opening twice)
  assertEqual(
    0 + mapGet(obApply, 'A'),
    1000,
    'Opening from zero applies once to reach opening balance',
  );
  console.log('✓ Opening balance / balance adjustment signed apply/reverse.');

  // --- Bulk delete uses same reverse rules ---
  const bulk = computeBulkDeleteBalanceDeltas([
    { type: 'transfer', amount: 50, accountId: 'A', toAccountId: 'B' },
    { type: 'expense', amount: 10, accountId: 'A' },
  ]);
  assertEqual(mapGet(bulk, 'A'), 60, 'Bulk reverse nets transfer+expense on A');
  assertEqual(mapGet(bulk, 'B'), -50, 'Bulk reverse debits B for transfer');

  // Bulk-delete signed balance history once (including negative adjustment)
  const bulkBal = computeBulkDeleteBalanceDeltas([
    { type: 'opening_balance', amount: 1000, accountId: 'A' },
    { type: 'balance_adjustment', amount: -250, accountId: 'A' },
  ]);
  // Reverse opening (-1000) + reverse adjustment (+250) = -750
  assertEqual(mapGet(bulkBal, 'A'), -750, 'Bulk reverse of opening+adjustment nets once');
  console.log('✓ Bulk delete deltas match shared reverse helpers.');

  // --- Edit simulation: reverse old transfer + apply new amount ---
  const oldT = { type: 'transfer' as const, amount: 100, accountId: 'A', toAccountId: 'B' };
  const newT = { type: 'transfer' as const, amount: 60, accountId: 'A', toAccountId: 'B' };
  const editNet = new Map<string, number>();
  for (const [id, d] of computeReverseBalanceDeltas(oldT)) {
    editNet.set(id, (editNet.get(id) ?? 0) + d);
  }
  for (const [id, d] of computeApplyBalanceDeltas(newT)) {
    editNet.set(id, (editNet.get(id) ?? 0) + d);
  }
  // Net: A +100-60 = +40, B -100+60 = -40 (as if only 40 less transferred)
  assertEqual(mapGet(editNet, 'A'), 40, 'Edit transfer amount nets correctly on source');
  assertEqual(mapGet(editNet, 'B'), -40, 'Edit transfer amount nets correctly on destination');
  console.log('✓ Edit simulation: reverse then apply.');

  // Transfer without toAccountId: no apply effect (must be rejected by validate before apply)
  const broken = computeApplyBalanceDeltas({ type: 'transfer', amount: 99, accountId: 'A' });
  assertEqual(broken.size, 0, 'Transfer without destination produces no apply deltas');
  assertEqual(
    requiredAccountIdsForApply({ type: 'transfer', amount: 99, accountId: 'A' }).length,
    0,
    'Transfer without destination has no required IDs (blocked by validate)',
  );

  console.log('All account balance effects tests passed.');
}

runTests();
