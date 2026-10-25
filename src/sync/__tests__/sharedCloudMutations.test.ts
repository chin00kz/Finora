/**
 * Regression: Shared IOU / connection mutation wrappers refuse cloud RPCs
 * while restore isolation is active (no network call is required).
 */
import {
  CLOUD_MUTATION_BLOCK_MESSAGE,
  clearRestoreIsolationInternal,
  enterRestoreIsolation,
  getCloudMutationBlockError,
  shouldAllowCloudMutation,
} from '../restoreIsolation';
import {
  acceptSharedIou,
  cancelSharedIou,
  confirmIouPayment,
  createSharedIou,
  declineSharedIou,
  GUARDED_SHARED_CLOUD_RPCS,
  markIouPaid,
  proposeIouPayment,
  rejectIouPayment,
  rejectSharedIou,
  respondConnectionRequest,
  sendConnectionRequest,
  setConnectionAutoAccept,
} from '../sharedCloudMutations';

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

async function runTests() {
  console.log('Running shared cloud mutation isolation tests...');
  installLocalStoragePolyfill();
  clearRestoreIsolationInternal();

  assertEqual(shouldAllowCloudMutation(false), true, 'Mutations allowed when not isolated');
  assertEqual(shouldAllowCloudMutation(true), false, 'Mutations denied when isolated');
  assertEqual(getCloudMutationBlockError(), null, 'No block error when unisolated');

  assert(
    GUARDED_SHARED_CLOUD_RPCS.length >= 12,
    'Guarded RPC catalog covers create/accept/settle/connection mutations',
  );
  for (const name of [
    'create_shared_iou',
    'accept_shared_iou',
    'decline_shared_iou',
    'cancel_shared_iou',
    'reject_shared_iou',
    'propose_iou_payment',
    'confirm_iou_payment',
    'reject_iou_payment',
    'mark_iou_paid',
    'send_connection_request',
    'respond_connection_request',
    'set_connection_auto_accept',
  ] as const) {
    assert(GUARDED_SHARED_CLOUD_RPCS.includes(name), `Catalog includes ${name}`);
  }

  enterRestoreIsolation({ recoveryKitId: 'rkit-mutations', backupExportedAt: 42 });
  assertEqual(
    getCloudMutationBlockError()?.message,
    CLOUD_MUTATION_BLOCK_MESSAGE,
    'Block error exposed while isolated',
  );

  const blockedResults = await Promise.all([
    createSharedIou({
      p_debtor_id: 'u2',
      p_amount: 10,
      p_currency: 'USD',
    }),
    acceptSharedIou('iou-1'),
    declineSharedIou('iou-1'),
    cancelSharedIou('iou-1'),
    rejectSharedIou('iou-1', null),
    proposeIouPayment({
      p_iou_id: 'iou-1',
      p_amount: 5,
      p_settlement_id: 'stl-1',
    }),
    confirmIouPayment('stl-1'),
    rejectIouPayment('stl-1'),
    markIouPaid({
      p_iou_id: 'iou-1',
      p_note: null,
      p_settlement_id: 'stl-1',
    }),
    sendConnectionRequest('u2'),
    respondConnectionRequest('conn-1', 'accepted'),
    setConnectionAutoAccept('conn-1', true),
  ]);

  for (const result of blockedResults) {
    assertEqual(result.data, null, 'Blocked mutation returns no data');
    assertEqual(
      result.error?.message,
      CLOUD_MUTATION_BLOCK_MESSAGE,
      'Blocked mutation returns isolation error',
    );
  }

  // Persistence: reload simulation must keep mutations blocked
  const raw = localStorage.getItem('finora-restore-isolation');
  assert(!!raw, 'Isolation state persisted');
  clearRestoreIsolationInternal();
  localStorage.setItem('finora-restore-isolation', raw!);
  const afterReload = await createSharedIou({
    p_debtor_id: 'u2',
    p_amount: 1,
    p_currency: 'USD',
  });
  assertEqual(
    afterReload.error?.message,
    CLOUD_MUTATION_BLOCK_MESSAGE,
    'Mutations still blocked after isolation rehydrate',
  );

  clearRestoreIsolationInternal();
  console.log('All shared cloud mutation isolation tests passed.');
}

runTests().catch(err => {
  console.error(err);
  throw err;
});
