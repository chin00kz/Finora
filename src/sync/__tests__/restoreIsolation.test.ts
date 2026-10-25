import {
  clearRestoreIsolationInternal,
  CLOUD_MUTATION_BLOCK_MESSAGE,
  cloudSyncBlockReason,
  enterRestoreIsolation,
  getCloudMutationBlockError,
  getIsolatedEditWarning,
  getPersonalFinanceEditBlockError,
  getRestoreIsolationPhase,
  getRestoreIsolationState,
  isCloudSyncBlocked,
  isPersonalFinanceEditFrozen,
  isRestoreIsolated,
  RESTORE_ISOLATION_STORAGE_KEY,
  setRestoreIsolationPhase,
  shouldAllowCloudMutation,
} from '../restoreIsolation';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

/** Minimal localStorage polyfill for Node test runner */
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

function runTests() {
  console.log('Running restore-isolation regression tests...');
  installLocalStoragePolyfill();

  clearRestoreIsolationInternal();
  assertEqual(isRestoreIsolated(), false, 'Starts unisolated');
  assertEqual(isCloudSyncBlocked(), false, 'Sync allowed when unisolated');

  enterRestoreIsolation({ recoveryKitId: 'rkit-test', backupExportedAt: 1 });
  assertEqual(
    getRestoreIsolationState()?.reason,
    'local_only_replace_all',
    'Default reason is local_only_replace_all',
  );
  assertEqual(isRestoreIsolated(), true, 'Isolation active after enter');
  clearRestoreIsolationInternal();
  enterRestoreIsolation({ recoveryKitId: 'rkit-drift', reason: 'epoch_drift' });
  assertEqual(getRestoreIsolationState()?.reason, 'epoch_drift', 'epoch_drift reason accepted');
  clearRestoreIsolationInternal();
  enterRestoreIsolation({ recoveryKitId: 'rkit-test', backupExportedAt: 1 });
  assertEqual(isRestoreIsolated(), true, 'Isolation active after re-enter');
  assertEqual(isCloudSyncBlocked(), true, 'Cloud sync blocked while isolated');
  assert(cloudSyncBlockReason().includes('isolated'), 'Block reason mentions isolation');
  assertEqual(getRestoreIsolationPhase(), 'isolated', 'Default phase is isolated');
  assertEqual(isPersonalFinanceEditFrozen(), false, 'Edits not frozen when merely isolated');
  assert(!!getIsolatedEditWarning(), 'Isolated edit warning present');
  assertEqual(shouldAllowCloudMutation(true), false, 'Cloud mutations disallowed while isolated');
  assertEqual(
    getCloudMutationBlockError()?.message,
    CLOUD_MUTATION_BLOCK_MESSAGE,
    'Mutation block message set while isolated',
  );
  assertEqual(
    getRestoreIsolationState()?.recoveryKitId,
    'rkit-test',
    'Isolation state retains recovery kit id',
  );
  assert(
    !!localStorage.getItem(RESTORE_ISOLATION_STORAGE_KEY),
    'Isolation persists in localStorage',
  );

  setRestoreIsolationPhase('reconciling');
  assertEqual(isPersonalFinanceEditFrozen(), true, 'Edits frozen while reconciling');
  assert(!!getPersonalFinanceEditBlockError(), 'Freeze block error while reconciling');
  setRestoreIsolationPhase('isolated');
  assertEqual(isPersonalFinanceEditFrozen(), false, 'Freeze lifted when back to isolated');

  // Persistence across "reload" simulation (sign-out/sign-in / network recovery re-read same key)
  const raw = localStorage.getItem(RESTORE_ISOLATION_STORAGE_KEY);
  assert(!!raw, 'Raw isolation state stored');
  clearRestoreIsolationInternal();
  assertEqual(isRestoreIsolated(), false, 'Cleared');
  assertEqual(getCloudMutationBlockError(), null, 'Mutation block cleared with isolation');
  localStorage.setItem(RESTORE_ISOLATION_STORAGE_KEY, raw!);
  assertEqual(isRestoreIsolated(), true, 'Rehydrates from localStorage after reload');
  assertEqual(isCloudSyncBlocked(), true, 'Still blocked after rehydrate');
  assertEqual(
    getRestoreIsolationState()?.recoveryKitId,
    'rkit-test',
    'Recovery kit id survives reload rehydrate',
  );

  clearRestoreIsolationInternal();
  console.log('All restore-isolation tests passed.');
}

runTests();
