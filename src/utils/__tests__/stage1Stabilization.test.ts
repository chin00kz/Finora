/**
 * Stage 1 stabilization regressions: undo toast type gate, account delete
 * reassignment decisions, signed balance-adjustment edit enablement rules.
 */
import {
  accountDeleteNeedsReassignment,
  soleAccountDeleteIsSafe,
} from '../accountDeletePlanHelpers';
import { isUndoToastSupportedType } from '../undoRecentTransaction';
import {
  computeApplyBalanceDeltas,
  computeReverseBalanceDeltas,
  validateAccountsForApply,
} from '../accountBalanceEffects';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

/** Mirrors TransactionEditSheet Save button enablement. */
function editSheetSaveEnabled(amount: string, signedBalanceType: boolean): boolean {
  if (amount === '') return false;
  if (isNaN(Number(amount))) return false;
  if (signedBalanceType) return Number(amount) !== 0;
  return Number(amount) > 0;
}

function runTests() {
  console.log('Running Stage 1 stabilization regression tests...');

  // Undo toast supports only expense/income (transfers use edit-sheet delete)
  assert(isUndoToastSupportedType('expense'), 'expense undoable');
  assert(isUndoToastSupportedType('income'), 'income undoable');
  assert(!isUndoToastSupportedType('transfer'), 'transfer not toast-undoable');
  assert(!isUndoToastSupportedType('balance_adjustment'), 'adjustment not toast-undoable');
  assert(!isUndoToastSupportedType('opening_balance'), 'opening not toast-undoable');

  // Undo reverse matches shared helpers (expense credit, income debit)
  const expenseReverse = computeReverseBalanceDeltas({
    type: 'expense',
    amount: 120,
    accountId: 'A',
  });
  assertEqual(expenseReverse.get('A'), 120, 'Undo expense restores credit');
  const incomeReverse = computeReverseBalanceDeltas({
    type: 'income',
    amount: 50,
    accountId: 'A',
  });
  assertEqual(incomeReverse.get('A'), -50, 'Undo income restores debit');

  // Documented order: reverse then delete (apply then reverse nets zero)
  const apply = computeApplyBalanceDeltas({ type: 'expense', amount: 120, accountId: 'A' });
  assertEqual(
    (apply.get('A') ?? 0) + (expenseReverse.get('A') ?? 0),
    0,
    'Apply+reverse nets zero for undo',
  );

  // Account delete: zero txns but recurring/outbox still needs reassignment
  assert(
    accountDeleteNeedsReassignment({
      transactionCount: 0,
      recurringCount: 1,
      goalLinkCount: 0,
      settlementRefCount: 0,
      outboxCount: 0,
      balanceToMerge: 0,
    }),
    'Recurring-only account needs reassignment',
  );
  assert(
    accountDeleteNeedsReassignment({
      transactionCount: 0,
      recurringCount: 0,
      goalLinkCount: 0,
      settlementRefCount: 0,
      outboxCount: 0,
      balanceToMerge: 250,
    }),
    'Non-zero balance with another account needs merge path',
  );
  assert(
    !accountDeleteNeedsReassignment({
      transactionCount: 0,
      recurringCount: 0,
      goalLinkCount: 0,
      settlementRefCount: 0,
      outboxCount: 0,
      balanceToMerge: 0,
    }),
    'Truly empty account can simple-delete',
  );

  // Sole account: orphan refs block; balance alone does not
  assert(
    !soleAccountDeleteIsSafe({
      transactionCount: 0,
      recurringCount: 1,
      goalLinkCount: 0,
      settlementRefCount: 0,
      outboxCount: 0,
      balanceToMerge: 0,
    }),
    'Sole account with recurring is unsafe',
  );
  assert(
    soleAccountDeleteIsSafe({
      transactionCount: 0,
      recurringCount: 0,
      goalLinkCount: 0,
      settlementRefCount: 0,
      outboxCount: 0,
      balanceToMerge: 999,
    }),
    'Sole empty-of-refs account with balance is deletable',
  );
  assert(
    !soleAccountDeleteIsSafe({
      transactionCount: 2,
      recurringCount: 0,
      goalLinkCount: 0,
      settlementRefCount: 0,
      outboxCount: 0,
      balanceToMerge: 0,
    }),
    'Sole account with transactions is unsafe',
  );

  // Negative balance_adjustment must be valid and Save-enabled
  assertEqual(
    validateAccountsForApply({ type: 'balance_adjustment', amount: -250, accountId: 'A' }),
    null,
    'Negative adjustment validates',
  );
  assert(editSheetSaveEnabled('-250', true), 'Save enabled for negative signed amount');
  assert(!editSheetSaveEnabled('0', true), 'Save disabled for zero signed amount');
  assert(!editSheetSaveEnabled('-10', false), 'Save disabled for negative expense');
  assert(editSheetSaveEnabled('10', false), 'Save enabled for positive expense');

  console.log('All Stage 1 stabilization tests passed.');
}

runTests();
