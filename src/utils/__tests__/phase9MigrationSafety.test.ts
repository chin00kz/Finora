/**
 * Phase 9 migration safety regressions (A1 backfill rerun, A2 reverse ack, A3 notify idempotency).
 */
import {
  PHASE9_LEGACY_ACK_BACKFILL_MARKER,
  isOverpaymentReverseDescription,
  legacyAckBackfillTimestamp,
  reverseOverpaymentIouAcknowledgedAtCreate,
  sharedIouAcknowledgedEventKey,
  shouldEmitAcknowledgementNotification,
  rejectBlockedByConfirmedPayments,
  shouldRunPhase9LegacyAckBackfill,
  simulateAckAfterMigrationRerun,
  simulateStatusAfterPhase9LegacyBackfill,
} from '../phase9MigrationSafety';
import { isRecipientAcknowledged } from '../sharedIouLifecycle';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function runTests() {
  console.log('Running Phase 9 migration safety tests...');

  assertEqual(
    PHASE9_LEGACY_ACK_BACKFILL_MARKER,
    'phase9_legacy_ack_backfill_v1',
    'marker id matches SQL',
  );

  // A1 — first apply runs backfill; rerun skips
  assert(shouldRunPhase9LegacyAckBackfill(false), 'first apply runs backfill');
  assert(!shouldRunPhase9LegacyAckBackfill(true), 'rerun skips backfill');

  const unackedActive = {
    status: 'accepted',
    recipient_acknowledged_at: null as null,
    accepted_at: 100,
    updated_at: 100,
    created_at: 100,
  };

  // First-time would stamp legacy accepted — but post-phase9 unacked create has NULL
  // and must survive rerun when marker is already present:
  assertEqual(
    simulateAckAfterMigrationRerun({
      markerPresentBeforeRerun: true,
      row: unackedActive,
    }),
    null,
    'rerun must not stamp new unacked IOUs',
  );

  // First-time legacy accepted with NULL ack gets stamped
  assertEqual(
    simulateAckAfterMigrationRerun({
      markerPresentBeforeRerun: false,
      row: unackedActive,
    }),
    100,
    'first apply stamps legacy accepted',
  );

  assertEqual(
    legacyAckBackfillTimestamp({ accepted_at: 5, updated_at: 9, created_at: 1 }),
    5,
    'prefer accepted_at',
  );

  // Existing pending rows: status unchanged; ack stays null
  {
    const pending = {
      status: 'pending',
      recipient_acknowledged_at: null as null,
      accepted_at: null as null,
      updated_at: 50,
      created_at: 50,
    };
    assertEqual(
      simulateStatusAfterPhase9LegacyBackfill(pending.status),
      'pending',
      'backfill does not promote pending',
    );
    assertEqual(
      simulateAckAfterMigrationRerun({
        markerPresentBeforeRerun: false,
        row: pending,
      }),
      null,
      'pending ack not stamped',
    );
  }

  assert(rejectBlockedByConfirmedPayments(1), 'confirmed payments block reject');
  assert(!rejectBlockedByConfirmedPayments(0), 'zero confirmed allows reject path');

  // A2 — reverse overpayment IOU acknowledged at create
  assert(
    reverseOverpaymentIouAcknowledgedAtCreate(),
    'reverse IOU acknowledged at insert',
  );
  assert(isOverpaymentReverseDescription('[Overpayment]'), 'overpay prefix');
  assert(isOverpaymentReverseDescription('[Overpayment] tip'), 'overpay with note');
  assert(!isOverpaymentReverseDescription('Dinner'), 'normal desc');

  const reverseShape = {
    status: 'accepted',
    recipient_acknowledged_at: 999,
    description: '[Overpayment]',
  };
  assert(
    isRecipientAcknowledged(reverseShape),
    'reverse IOU with ack set is not awaiting',
  );
  assert(
    !isRecipientAcknowledged({
      status: 'accepted',
      recipient_acknowledged_at: null,
    }),
    'active-unacked remains unacked',
  );

  // A3 — notification only on first ack; stable event_key
  assertEqual(
    sharedIouAcknowledgedEventKey('iou_abc'),
    'shared_iou_acknowledged:iou_abc',
    'stable event_key',
  );
  assert(
    shouldEmitAcknowledgementNotification({
      priorAck: null,
      nextAck: 1,
      didTransition: true,
    }),
    'emit on first ack',
  );
  assert(
    !shouldEmitAcknowledgementNotification({
      priorAck: 1,
      nextAck: 1,
      didTransition: false,
    }),
    'no emit on idempotent already-acked return',
  );
  assert(
    !shouldEmitAcknowledgementNotification({
      priorAck: null,
      nextAck: null,
      didTransition: false,
    }),
    'no emit without transition',
  );

  // Two identical event keys → unique constraint / ON CONFLICT DO NOTHING (documented)
  assertEqual(
    sharedIouAcknowledgedEventKey('iou_1'),
    sharedIouAcknowledgedEventKey('iou_1'),
    'retry uses identical event_key',
  );

  console.log('All Phase 9 migration safety tests passed.');
}

runTests();
