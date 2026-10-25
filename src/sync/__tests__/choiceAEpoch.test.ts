/**
 * Choice A / dataset epoch — pure client regressions (no live Supabase).
 * Covers: feature kill-switch, confirmation, payload limits, epoch drift
 * evaluation, fingerprint ignore of dataset_epoch, omitted-column semantics,
 * legacy epoch-0 sync mode.
 */
import {
  CHOICE_A_ENABLED,
  KEEP_DEVICE_CONFIRMATION_PHRASE,
  choiceAUnavailableReason,
  evaluateChoiceAConfirmation,
  evaluateChoiceAPayloadLimits,
  isChoiceAAvailable,
} from '../choiceAFlags';
import {
  evaluateEpochDrift,
  getLocalDatasetEpoch,
  setLocalDatasetEpoch,
  shouldUseEpochGatedRpcSync,
  clearLocalDatasetEpoch,
  isEpochMismatchError,
} from '../datasetEpoch';
import {
  fingerprintPersonalSnapshot,
  normalizeRecordForCompare,
} from '../cloudReconciliationCompare';
import { BACKUP_TABLE_KEYS, type BackupTableKey } from '../../utils/jsonBackup';
import {
  clearRestoreIsolationInternal,
  enterRestoreIsolation,
  getRestoreIsolationState,
} from '../restoreIsolation';

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

/**
 * Documents omitted-column upsert attack mitigation:
 * Direct PostgREST at epoch>0 is blocked; RPC identity force always sets
 * dataset_epoch from p_epoch (client-side mirror of finora_force_row_identity).
 */
function forceRowIdentity(
  rows: Record<string, unknown>[],
  userId: string,
  epoch: number,
): Record<string, unknown>[] {
  return rows.map(elem => {
    const { user_id: _u, userId: _u2, ...rest } = elem;
    return { ...rest, user_id: userId, dataset_epoch: epoch };
  });
}

function runTests() {
  console.log('Running Choice A / epoch regression tests...');
  installLocalStoragePolyfill();
  clearRestoreIsolationInternal();

  assertEqual(CHOICE_A_ENABLED, false, 'Choice A remains disabled');
  assertEqual(isChoiceAAvailable(), false, 'isChoiceAAvailable false');
  assert(choiceAUnavailableReason().includes('disabled'), 'Unavailable reason mentions disabled');

  assertEqual(evaluateChoiceAConfirmation('KEEP DEVICE'), true, 'Exact confirmation');
  assertEqual(evaluateChoiceAConfirmation('keep device'), false, 'Case sensitive');
  assertEqual(evaluateChoiceAConfirmation(''), false, 'Empty confirmation rejected');
  assertEqual(KEEP_DEVICE_CONFIRMATION_PHRASE, 'KEEP DEVICE', 'Phrase constant stable');

  // Disabled gate: available helpers refuse enablement without importing apply RPC path
  assert(!isChoiceAAvailable() && !CHOICE_A_ENABLED, 'Apply path must stay behind kill-switch');

  const empty = emptySnapshot();
  assertEqual(evaluateChoiceAPayloadLimits(empty).ok, false, 'Empty forbidden');
  assertEqual(evaluateChoiceAPayloadLimits(empty).reason, 'empty', 'Empty reason');

  const withAccount = emptySnapshot();
  withAccount.accounts = [
    { id: 'a1', name: 'Cash', balance: 1, type: 'cash', currency: 'LKR', includeInTotal: true },
  ];
  assertEqual(evaluateChoiceAPayloadLimits(withAccount).ok, true, 'Non-empty ok');

  clearLocalDatasetEpoch('u1');
  assertEqual(getLocalDatasetEpoch('u1'), 0, 'Default local epoch 0');
  assertEqual(shouldUseEpochGatedRpcSync(0), false, 'epoch 0 uses direct sync');
  assertEqual(shouldUseEpochGatedRpcSync(1), true, 'epoch > 0 uses RPC');
  setLocalDatasetEpoch('u1', 3);
  assertEqual(getLocalDatasetEpoch('u1'), 3, 'Local epoch persisted');

  assertEqual(evaluateEpochDrift(0, 0).ok, true, '0/0 ok');
  assertEqual(evaluateEpochDrift(1, 1).ok, true, '1/1 ok');
  assertEqual(evaluateEpochDrift(0, 1).ok, false, '0 vs 1 drift');
  assertEqual(evaluateEpochDrift(2, 1).ok, false, '2 vs 1 drift');

  assertEqual(
    normalizeRecordForCompare({ id: 'a1', name: 'Cash', dataset_epoch: 0 }),
    normalizeRecordForCompare({ id: 'a1', name: 'Cash', dataset_epoch: 9 }),
    'dataset_epoch excluded from compare',
  );
  assertEqual(
    normalizeRecordForCompare({ id: 'a1', name: 'Cash', datasetEpoch: 1 }),
    normalizeRecordForCompare({ id: 'a1', name: 'Cash', datasetEpoch: 2 }),
    'datasetEpoch excluded from compare',
  );

  const snapA = emptySnapshot();
  snapA.accounts = [{ id: 'a1', name: 'Cash', balance: 10, dataset_epoch: 0 }];
  const snapB = emptySnapshot();
  snapB.accounts = [{ id: 'a1', name: 'Cash', balance: 10, dataset_epoch: 5 }];
  assertEqual(
    fingerprintPersonalSnapshot(snapA),
    fingerprintPersonalSnapshot(snapB),
    'Fingerprint ignores dataset_epoch',
  );

  const forced = forceRowIdentity(
    [{ id: 'a1', name: 'X', user_id: 'attacker', dataset_epoch: 0 }],
    'owner',
    7,
  );
  assertEqual(forced[0]!.user_id, 'owner', 'Forced user_id wins');
  assertEqual(forced[0]!.dataset_epoch, 7, 'Forced epoch wins over omitted/stale');
  assertEqual(forced[0]!.name, 'X', 'Business fields preserved');

  assert(
    isEpochMismatchError('finora_dataset_epoch_required: Upgrade Finora'),
    'Detects epoch_required',
  );
  assert(isEpochMismatchError('finora_dataset_epoch_mismatch'), 'Detects epoch_mismatch');
  assert(!isEpochMismatchError('network down'), 'Non-epoch errors ignored');

  clearRestoreIsolationInternal();
  enterRestoreIsolation({ recoveryKitId: 'rkit-drift', reason: 'epoch_drift' });
  assertEqual(getRestoreIsolationState()?.reason, 'epoch_drift', 'epoch_drift reason stored');
  clearRestoreIsolationInternal();

  assert(evaluateEpochDrift(4, 4).ok, 'Matching epochs allow push');
  assert(!evaluateEpochDrift(4, 5).ok, 'Stale local blocked (other device Choice A)');

  console.log('All Choice A / epoch tests passed.');
}

runTests();
