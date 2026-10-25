/**
 * Phase 1 reconciliation: diffs, fingerprints, stale preview, pagination
 * completeness, outbox quarantine, isolation lifecycle (pure / localStorage).
 */
import {
  buildAccountTxnConsistencyWarnings,
  diffPersonalSnapshots,
  evaluateChoiceBCloudFreshness,
  fingerprintPersonalSnapshot,
  isPaginatedFetchComplete,
  normalizeRecordForCompare,
  USE_CLOUD_CONFIRMATION_PHRASE,
  validatePersonalSnapshotIntegrity,
} from '../cloudReconciliationCompare';
import { shouldAutoApplyOutboxEntry } from '../outboxQuarantine';
import {
  assertPersonalFinanceUserMutationAllowed,
  beginPersonalFinanceSystemWrite,
  endPersonalFinanceSystemWrite,
  isGuardedPersonalDexieTable,
  personalFinanceMutationBlockReason,
} from '../personalFinanceWriteGate';
import {
  clearRestoreIsolationInternal,
  enterRestoreIsolation,
  getPersonalFinanceEditBlockError,
  getRestoreIsolationPhase,
  isPersonalFinanceEditFrozen,
  isRestoreIsolated,
  setRestoreIsolationPhase,
} from '../restoreIsolation';
import type { BackupTableKey } from '../../utils/jsonBackup';
import { BACKUP_TABLE_KEYS } from '../../utils/jsonBackup';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function installLocalStoragePolyfill() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

function emptySnapshot(): Record<BackupTableKey, unknown[]> {
  const data = {} as Record<BackupTableKey, unknown[]>;
  for (const key of BACKUP_TABLE_KEYS) data[key] = [];
  return data;
}

function runTests() {
  console.log('Running cloud reconciliation regression tests...');
  installLocalStoragePolyfill();
  clearRestoreIsolationInternal();

  // Pagination completeness
  assertEqual(isPaginatedFetchComplete(0, 0), true, 'Empty table complete');
  assertEqual(isPaginatedFetchComplete(1000, 1000), true, 'Exact page complete');
  assertEqual(isPaginatedFetchComplete(999, 1000), false, 'Short fetch incomplete');
  assertEqual(isPaginatedFetchComplete(1001, 1000), false, 'Over-fetch incomplete');

  // Compare ignores updatedAt
  assertEqual(
    normalizeRecordForCompare({ id: 'a1', name: 'Cash', balance: 10, updatedAt: 1 }),
    normalizeRecordForCompare({ id: 'a1', name: 'Cash', balance: 10, updatedAt: 999 }),
    'updatedAt excluded from compare',
  );
  assert(
    normalizeRecordForCompare({ id: 'a1', balance: 10 }) !==
      normalizeRecordForCompare({ id: 'a1', balance: 11 }),
    'balance difference is meaningful',
  );

  // Diff buckets
  const local = emptySnapshot();
  const cloud = emptySnapshot();
  local.accounts = [
    { id: 'a1', name: 'Cash', balance: 100, updatedAt: 1 },
    { id: 'a2', name: 'LocalOnly', balance: 1, updatedAt: 1 },
  ];
  cloud.accounts = [
    { id: 'a1', name: 'Cash', balance: 200, updatedAt: 9 },
    { id: 'a3', name: 'CloudOnly', balance: 5, updatedAt: 9 },
  ];
  local.transactions = [
    { id: 't1', accountId: 'a1', amount: 10, type: 'expense', updatedAt: 1 },
    { id: 'tLocal', accountId: 'a1', amount: 3, type: 'expense', updatedAt: 1 },
  ];
  cloud.transactions = [
    { id: 't1', accountId: 'a1', amount: 10, type: 'expense', updatedAt: 2 },
    { id: 't2', accountId: 'a3', amount: 5, type: 'expense', updatedAt: 2 },
  ];

  const diffs = diffPersonalSnapshots(local, cloud);
  const accDiff = diffs.find(d => d.table === 'accounts')!;
  assertEqual(accDiff.localOnlyIds.join(','), 'a2', 'Local-only account');
  assertEqual(accDiff.cloudOnlyIds.join(','), 'a3', 'Cloud-only account');
  assertEqual(accDiff.differentIds.join(','), 'a1', 'Same-id balance difference');
  assertEqual(accDiff.equalCount, 0, 'No equal accounts');

  const txnDiff = diffs.find(d => d.table === 'transactions')!;
  assertEqual(txnDiff.equalCount, 1, 'Txn equal ignoring updatedAt');
  assertEqual(txnDiff.cloudOnlyIds.join(','), 't2', 'Cloud-only txn');
  assertEqual(txnDiff.localOnlyIds.join(','), 'tLocal', 'Local-only txn');

  // Fingerprint / stale preview detection
  const fp1 = fingerprintPersonalSnapshot(cloud);
  const cloudChanged = emptySnapshot();
  for (const key of BACKUP_TABLE_KEYS) cloudChanged[key] = [...(cloud[key] || [])];
  cloudChanged.accounts = [
    ...(cloud.accounts as object[]),
    { id: 'a4', name: 'New', balance: 0, updatedAt: 1 },
  ];
  const fp2 = fingerprintPersonalSnapshot(cloudChanged);
  assert(fp1 !== fp2, 'Fingerprint changes when cloud gains a row');
  assertEqual(
    fingerprintPersonalSnapshot(cloud),
    fp1,
    'Fingerprint stable for identical payload',
  );

  // Integrity validation
  const bad = emptySnapshot();
  bad.transactions = [{ id: 't9', accountId: 'missing', type: 'expense', amount: 1 }];
  const badResult = validatePersonalSnapshotIntegrity(bad);
  assertEqual(badResult.ok, false, 'Missing account ref fails validation');

  const good = emptySnapshot();
  good.accounts = [{ id: 'a1', name: 'A', balance: 0 }];
  good.transactions = [
    { id: 't1', accountId: 'a1', toAccountId: 'a1', type: 'transfer', amount: 1 },
  ];
  assertEqual(validatePersonalSnapshotIntegrity(good).ok, true, 'Present refs pass');

  const xferBad = emptySnapshot();
  xferBad.accounts = [{ id: 'a1', name: 'A', balance: 0 }];
  xferBad.transactions = [
    { id: 't1', accountId: 'a1', toAccountId: 'gone', type: 'transfer', amount: 1 },
  ];
  assertEqual(
    validatePersonalSnapshotIntegrity(xferBad).ok,
    false,
    'Missing transfer target fails',
  );

  const consistency = buildAccountTxnConsistencyWarnings(local, cloud);
  assert(
    consistency.some(w => w.kind === 'balance_mismatch'),
    'Balance mismatch warning emitted',
  );
  assert(
    consistency.some(w => w.kind === 'linked_txn_set_mismatch'),
    'Linked txn set mismatch warning emitted',
  );

  // Outbox quarantine gate
  assertEqual(shouldAutoApplyOutboxEntry({}), true, 'Non-quarantined may apply');
  assertEqual(
    shouldAutoApplyOutboxEntry({ quarantinedAt: Date.now() }),
    false,
    'Quarantined must not auto-apply',
  );

  // Isolation lifecycle / freeze
  enterRestoreIsolation({ recoveryKitId: 'rkit-rec', backupExportedAt: 1 });
  assertEqual(getRestoreIsolationPhase(), 'isolated', 'Default phase isolated');
  assertEqual(isPersonalFinanceEditFrozen(), false, 'Edits allowed while merely isolated');
  assertEqual(getPersonalFinanceEditBlockError(), null, 'No freeze error while isolated');

  setRestoreIsolationPhase('reconciling');
  assertEqual(getRestoreIsolationPhase(), 'reconciling', 'Phase reconciling');
  assertEqual(isPersonalFinanceEditFrozen(), true, 'Edits frozen while reconciling');
  assert(!!getPersonalFinanceEditBlockError(), 'Freeze error while reconciling');

  // Simulated Choice B success: clear isolation
  clearRestoreIsolationInternal();
  assertEqual(isRestoreIsolated(), false, 'Isolation cleared after successful Choice B');
  assertEqual(isPersonalFinanceEditFrozen(), false, 'Freeze cleared with isolation');

  // Rollback path: failed apply leaves isolation
  enterRestoreIsolation({ recoveryKitId: 'rkit-fail' });
  setRestoreIsolationPhase('reconciling');
  assertEqual(isRestoreIsolated(), true, 'Failed path keeps isolation');
  setRestoreIsolationPhase('isolated');
  assertEqual(isRestoreIsolated(), true, 'Cancel preview keeps isolation');
  assertEqual(isPersonalFinanceEditFrozen(), false, 'Cancel unfreezes edits');

  assertEqual(USE_CLOUD_CONFIRMATION_PHRASE, 'USE CLOUD', 'Confirmation phrase fixed');

  // Stale / incomplete Choice B abort (pure)
  assertEqual(
    evaluateChoiceBCloudFreshness({
      previewFingerprint: 'a',
      freshFingerprint: 'b',
      freshFetchOk: true,
      freshIntegrityOk: true,
    }).ok,
    false,
    'Stale fingerprint aborts',
  );
  assertEqual(
    evaluateChoiceBCloudFreshness({
      previewFingerprint: 'a',
      freshFingerprint: 'a',
      freshFetchOk: false,
      freshIntegrityOk: true,
    }).ok,
    false,
    'Incomplete fetch aborts',
  );
  assertEqual(
    evaluateChoiceBCloudFreshness({
      previewFingerprint: 'a',
      freshFingerprint: 'a',
      freshFetchOk: true,
      freshIntegrityOk: false,
    }).ok,
    false,
    'Integrity failure aborts',
  );
  assertEqual(
    evaluateChoiceBCloudFreshness({
      previewFingerprint: 'a',
      freshFingerprint: 'a',
      freshFetchOk: true,
      freshIntegrityOk: true,
    }).ok,
    true,
    'Matching complete snapshot allowed',
  );

  // Mutation gate while reconciling
  enterRestoreIsolation({ recoveryKitId: 'rkit-gate' });
  setRestoreIsolationPhase('reconciling');
  assert(isGuardedPersonalDexieTable('accounts'), 'accounts table guarded');
  assert(!isGuardedPersonalDexieTable('pendingAccountOutbox'), 'outbox not gated');
  assert(!isGuardedPersonalDexieTable('localRestoreKits'), 'kits not gated');
  assert(
    !!personalFinanceMutationBlockReason('transactions'),
    'transactions blocked while reconciling',
  );
  let threw = false;
  try {
    assertPersonalFinanceUserMutationAllowed();
  } catch {
    threw = true;
  }
  assert(threw, 'User mutation assert throws while reconciling');

  beginPersonalFinanceSystemWrite();
  assertEqual(
    personalFinanceMutationBlockReason('accounts'),
    null,
    'System write bypasses gate',
  );
  assertPersonalFinanceUserMutationAllowed(); // must not throw
  endPersonalFinanceSystemWrite();
  assert(
    !!personalFinanceMutationBlockReason('accounts'),
    'Gate restores after system write ends',
  );

  // Post-Choice-B simulation: clear isolation ⇒ mutations allowed; quarantine still blocks auto-apply
  clearRestoreIsolationInternal();
  assertEqual(personalFinanceMutationBlockReason('accounts'), null, 'Gate open after clear');
  assertEqual(
    shouldAutoApplyOutboxEntry({ quarantinedAt: Date.now() }),
    false,
    'Quarantined outbox still blocked after isolation clear',
  );

  clearRestoreIsolationInternal();
  console.log('All cloud reconciliation tests passed.');
}

runTests();
