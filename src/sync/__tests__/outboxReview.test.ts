import {
  shouldAutoApplyOutboxEntry,
  type OutboxBalanceEffectStatus,
  type OutboxCloudSettlementStatus,
} from '../outboxQuarantine';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

/**
 * Pure classification helpers mirroring buildOutboxReviewRows logic
 * (without IndexedDB) for regression coverage of review semantics.
 */
function classifyBalanceEffect(params: {
  hasExistingTxn: boolean;
  accountExists: boolean;
}): OutboxBalanceEffectStatus {
  if (params.hasExistingTxn) return 'already_recorded';
  if (!params.accountExists) return 'account_missing';
  return 'not_recorded';
}

function classifyCloudStatus(
  status: 'pending' | 'confirmed' | 'rejected' | undefined,
): OutboxCloudSettlementStatus {
  if (!status) return 'not_in_cache';
  return status;
}

function runTests() {
  console.log('Running outbox review classification tests...');

  assertEqual(
    classifyBalanceEffect({ hasExistingTxn: true, accountExists: true }),
    'already_recorded',
    'Existing settlement txn detected',
  );
  assertEqual(
    classifyBalanceEffect({ hasExistingTxn: false, accountExists: false }),
    'account_missing',
    'Missing account flagged',
  );
  assertEqual(
    classifyBalanceEffect({ hasExistingTxn: false, accountExists: true }),
    'not_recorded',
    'Pending local effect',
  );

  assertEqual(classifyCloudStatus('confirmed'), 'confirmed', 'Confirmed settlement');
  assertEqual(classifyCloudStatus('pending'), 'pending', 'Pending settlement');
  assertEqual(classifyCloudStatus(undefined), 'not_in_cache', 'Missing cache row');

  assertEqual(shouldAutoApplyOutboxEntry({}), true, 'Non-quarantined may apply');
  assertEqual(
    shouldAutoApplyOutboxEntry({ quarantinedAt: 1 }),
    false,
    'Quarantined never auto-applies',
  );

  console.log('All outbox review tests passed.');
}

runTests();
