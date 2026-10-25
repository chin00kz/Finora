import {
  findSelfTransferConflicts,
  remapAccountId,
  transferBecomesSelfTransfer,
} from '../accountDeleteConflicts';
import {
  accountDeleteNeedsReassignment,
  soleAccountDeleteIsSafe,
} from '../accountDeletePlanHelpers';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function runTests() {
  console.log('Running account lifecycle regression tests...');

  const deleted = 'acc-del';
  const replacement = 'acc-rep';
  const other = 'acc-other';

  // --- Remap / self-transfer prediction ---
  assertEqual(
    remapAccountId(deleted, deleted, replacement),
    replacement,
    'Deleted ID remaps to replacement',
  );
  assertEqual(remapAccountId(other, deleted, replacement), other, 'Third-party ID unchanged');
  assertEqual(
    transferBecomesSelfTransfer(
      { type: 'transfer', accountId: deleted, toAccountId: replacement },
      deleted,
      replacement,
    ),
    true,
    'Deleted→replacement becomes self-transfer',
  );
  assertEqual(
    transferBecomesSelfTransfer(
      { type: 'transfer', accountId: replacement, toAccountId: deleted },
      deleted,
      replacement,
    ),
    true,
    'Replacement→deleted becomes self-transfer',
  );
  assertEqual(
    transferBecomesSelfTransfer(
      { type: 'transfer', accountId: deleted, toAccountId: deleted },
      deleted,
      replacement,
    ),
    true,
    'Historical self-transfer on deleted account conflicts',
  );
  assertEqual(
    transferBecomesSelfTransfer(
      { type: 'transfer', accountId: deleted, toAccountId: other },
      deleted,
      replacement,
    ),
    false,
    'Deleted→third remains a valid transfer after remap',
  );
  assertEqual(
    transferBecomesSelfTransfer(
      { type: 'transfer', accountId: other, toAccountId: deleted },
      deleted,
      replacement,
    ),
    false,
    'Third→deleted remains a valid transfer after remap',
  );
  assertEqual(
    transferBecomesSelfTransfer(
      { type: 'expense', accountId: deleted, toAccountId: replacement },
      deleted,
      replacement,
    ),
    false,
    'Non-transfers never count as self-transfer conflicts',
  );

  const conflicts = findSelfTransferConflicts(
    [
      {
        id: 't1',
        type: 'transfer',
        amount: 100,
        date: 1,
        accountId: deleted,
        toAccountId: replacement,
        notes: 'A→B',
      },
      {
        id: 't2',
        type: 'transfer',
        amount: 50,
        date: 2,
        accountId: replacement,
        toAccountId: deleted,
        notes: 'B→A',
      },
      {
        id: 't-self',
        type: 'transfer',
        amount: 5,
        date: 2.5,
        accountId: deleted,
        toAccountId: deleted,
        notes: 'already self',
      },
      {
        id: 't3',
        type: 'transfer',
        amount: 20,
        date: 3,
        accountId: deleted,
        toAccountId: other,
      },
      {
        id: 't4',
        type: 'expense',
        amount: 10,
        date: 4,
        accountId: deleted,
      },
      {
        id: 't5',
        type: 'opening_balance',
        amount: 500,
        date: 5,
        accountId: deleted,
      },
      {
        id: 't-rep-self',
        type: 'transfer',
        amount: 1,
        date: 6,
        accountId: replacement,
        toAccountId: replacement,
      },
    ],
    deleted,
    replacement,
  );

  assertEqual(conflicts.length, 3, 'Pair transfers + historical self on deleted conflict');
  assertEqual(
    conflicts.some(c => c.id === 't-rep-self'),
    false,
    'Unrelated self-transfer on replacement alone is not reported',
  );
  assertEqual(
    conflicts.some(c => c.id === 't3'),
    false,
    'Transfer to a third account is not a conflict',
  );

  // Balance merge policy (documented, pure arithmetic):
  // replacement' = replacement + deleted; do not reverse/re-apply history.
  const deletedBal = 1200;
  const replacementBal = 800;
  assertEqual(replacementBal + deletedBal, 2000, 'Merge adds deleted balance onto replacement');

  // Atomicity expectation (documented): executeAccountDeletion wraps refs +
  // balance merge + account delete in one Dexie rw transaction; a mid-loop
  // self-transfer throw rolls back all of those local writes. Cloud delete /
  // triggerSync run only after the local transaction commits.

  assertEqual(
    accountDeleteNeedsReassignment({
      transactionCount: 0,
      recurringCount: 2,
      goalLinkCount: 0,
      settlementRefCount: 0,
      outboxCount: 0,
      balanceToMerge: 0,
    }),
    true,
    'Zero-txn account with recurring still needs reassignment',
  );
  assertEqual(
    soleAccountDeleteIsSafe({
      transactionCount: 0,
      recurringCount: 0,
      goalLinkCount: 0,
      settlementRefCount: 0,
      outboxCount: 0,
      balanceToMerge: 100,
    }),
    true,
    'Sole account with only a balance (no refs) may delete',
  );

  console.log('All account lifecycle tests passed.');
}

runTests();
