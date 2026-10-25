/**
 * Shared IOU acknowledgement vs usability (phase 9).
 */
import {
  canAcknowledgeSharedIou,
  canOperateSettlementsOnSharedIou,
  canRejectSharedIou,
  getAwaitingAcknowledgementLabel,
  getSharedIouAckUiState,
  isRecipientAcknowledged,
  isSharedIouOperationallyActive,
  resolveDebtorRejectRpc,
} from '../sharedIouLifecycle';
import {
  canProposePayment,
  canSubmitMarkPaid,
  getSharedIouSettlementStatus,
  resolveMarkPaidRemainingAmount,
} from '../sharedIouSettlementEngine';
import type { CacheSharedIouSettlement } from '../../db/db';
import {
  rejectBlockedByConfirmedPayments,
  simulateStatusAfterPhase9LegacyBackfill,
} from '../phase9MigrationSafety';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function stl(amount: number, status: CacheSharedIouSettlement['status']): CacheSharedIouSettlement {
  return {
    id: `stl_${amount}_${status}`,
    shared_iou_id: 'iou_1',
    amount,
    proposed_by: 'debtor',
    status,
    created_at: 1,
  };
}

function runTests() {
  console.log('Running Shared IOU lifecycle / acknowledgement tests...');

  // Existing pending IOUs remain pending after Phase 9 backfill (no status rewrite)
  {
    assertEqual(
      simulateStatusAfterPhase9LegacyBackfill('pending'),
      'pending',
      'legacy pending status unchanged by backfill',
    );
    assertEqual(
      getSharedIouAckUiState({ status: 'pending' }),
      'legacy_pending',
      'legacy pending UI',
    );
    assert(!canOperateSettlementsOnSharedIou('pending'), 'pending still not settleable');
  }

  // Phase 8 compat: pending → decline RPC; accepted/active → reject RPC
  {
    assertEqual(
      resolveDebtorRejectRpc('pending'),
      'decline_shared_iou',
      'pending routes to decline',
    );
    assertEqual(
      resolveDebtorRejectRpc('accepted'),
      'reject_shared_iou',
      'accepted routes to reject',
    );
    assertEqual(
      resolveDebtorRejectRpc('active'),
      'reject_shared_iou',
      'UI active (cloud accepted) routes to reject',
    );
  }

  // New IOUs operational before acknowledgement
  {
    const created = { status: 'accepted', recipient_acknowledged_at: null as null };
    assert(isSharedIouOperationallyActive(created.status), 'new IOU is operationally active');
    assert(canOperateSettlementsOnSharedIou(created.status), 'settlements allowed when accepted');
    assert(!isRecipientAcknowledged(created), 'not acknowledged yet');
    assertEqual(
      getSharedIouAckUiState(created),
      'awaiting_acknowledgement',
      'UI state awaiting acknowledgement',
    );
    assertEqual(
      getAwaitingAcknowledgementLabel(),
      'Awaiting recipient acknowledgement',
      'badge label',
    );
  }

  // Unacked with zero confirmed payments can be rejected
  {
    const unacked = { status: 'accepted', recipient_acknowledged_at: null as null };
    assert(
      canAcknowledgeSharedIou({
        status: unacked.status,
        isDebtor: true,
        recipientAcknowledged: false,
      }),
      'debtor may acknowledge',
    );
    assert(
      canRejectSharedIou({
        status: unacked.status,
        isDebtor: true,
        confirmedPaymentTotal: 0,
      }),
      'debtor may reject unacked with zero confirmed payments',
    );
    assert(
      !canAcknowledgeSharedIou({
        status: unacked.status,
        isDebtor: false,
        recipientAcknowledged: false,
      }),
      'creditor cannot acknowledge',
    );
  }

  // Rejection with confirmed payments is blocked (UI + SQL mirror)
  {
    assert(
      rejectBlockedByConfirmedPayments(40),
      'SQL mirror: confirmed payments block reject',
    );
    assert(
      !canRejectSharedIou({
        status: 'accepted',
        isDebtor: true,
        confirmedPaymentTotal: 40,
      }),
      'UI gate blocks reject when confirmed payments exist',
    );
    assert(
      !canRejectSharedIou({
        status: 'accepted',
        isDebtor: true,
        confirmedPaymentTotal: 0.01,
      }),
      'any positive confirmed total blocks reject',
    );
  }

  // Partial + Mark Paid before acknowledgement (math + gates; not reject-after-partial)
  {
    const original = 100;
    const settlements = [stl(40, 'confirmed')];
    const fin = getSharedIouSettlementStatus(original, settlements);
    assertEqual(fin.remainingAmount, 60, 'partial remaining before ack');
    const markPaid = resolveMarkPaidRemainingAmount({
      originalAmount: original,
      unifiedRemainingAmount: fin.remainingAmount,
      settlements,
    });
    assertEqual(markPaid, 60, 'Mark Paid remaining before ack');
    assert(canSubmitMarkPaid(markPaid), 'Mark Paid submit allowed');
    assert(
      canOperateSettlementsOnSharedIou('accepted'),
      'creator settlement ops allowed pre-ack',
    );
    assert(
      canProposePayment('shared', 'active', 'iOweThem', fin.availableToPropose),
      'debtor can propose while unacked if UI status is active',
    );
    assertEqual(fin.confirmedTotal, 40, 'confirmed total tracked');
    assert(
      !canRejectSharedIou({
        status: 'accepted',
        isDebtor: true,
        confirmedPaymentTotal: fin.confirmedTotal,
      }),
      'cannot reject after confirmed partial',
    );
  }

  // Acknowledged → consistent state
  {
    const acked = { status: 'accepted', recipient_acknowledged_at: 1_700_000_000_000 };
    assert(isRecipientAcknowledged(acked), 'acked');
    assertEqual(getSharedIouAckUiState(acked), 'acknowledged', 'UI acknowledged');
    assert(
      !canAcknowledgeSharedIou({
        status: 'accepted',
        isDebtor: true,
        recipientAcknowledged: true,
      }),
      'cannot re-acknowledge',
    );
  }

  // Rejected visible + blocks new settlements
  {
    const rejected = { status: 'rejected', recipient_acknowledged_at: null as null };
    assertEqual(getSharedIouAckUiState(rejected), 'rejected', 'rejected UI');
    assert(!canOperateSettlementsOnSharedIou('rejected'), 'no settlements after reject');
    assert(
      !canProposePayment('shared', 'rejected', 'iOweThem', 50),
      'propose blocked when unified status rejected',
    );
    assert(
      !canRejectSharedIou({ status: 'rejected', isDebtor: true, confirmedPaymentTotal: 0 }),
      'reject gate closed on already rejected',
    );
  }

  // Idempotent ack semantics
  {
    const acked = { status: 'accepted', recipient_acknowledged_at: 99 };
    assert(isRecipientAcknowledged(acked), 'still acked');
    assertEqual(getSharedIouAckUiState(acked), 'acknowledged', 'stable across remap');
  }

  // Non-participant cannot ack/reject
  {
    assert(
      !canAcknowledgeSharedIou({
        status: 'accepted',
        isDebtor: false,
        recipientAcknowledged: false,
      }),
      'non-debtor cannot acknowledge',
    );
    assert(
      !canRejectSharedIou({ status: 'accepted', isDebtor: false, confirmedPaymentTotal: 0 }),
      'non-debtor cannot reject',
    );
  }

  // Legacy accepted without column
  {
    assert(
      isRecipientAcknowledged({ status: 'accepted', recipient_acknowledged_at: undefined }),
      'legacy accepted without column treated as acknowledged',
    );
  }

  // Auto-accept create shape
  {
    const auto = { status: 'accepted', recipient_acknowledged_at: Date.now() };
    assert(isRecipientAcknowledged(auto), 'auto-accept is acknowledged');
    assertEqual(getSharedIouAckUiState(auto), 'acknowledged', 'no awaiting badge');
  }

  console.log('All Shared IOU lifecycle / acknowledgement tests passed.');
}

runTests();
