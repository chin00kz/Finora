/**
 * Pure helpers documenting Phase 9 migration safety (A1–A3).
 * Mirrors rules encoded in supabase-schema-migration-phase9-immediate-active-ack.sql.
 */

/** Marker written after the one-time legacy acknowledgement backfill. */
export const PHASE9_LEGACY_ACK_BACKFILL_MARKER = 'phase9_legacy_ack_backfill_v1';

/** Stable notification event_key for first acknowledgement (no timestamp). */
export function sharedIouAcknowledgedEventKey(iouId: string): string {
  return `shared_iou_acknowledged:${iouId}`;
}

/**
 * Legacy backfill runs only when the durable marker is absent.
 * Re-applying Phase 9 after new unacked IOUs exist must NOT re-run backfill.
 */
export function shouldRunPhase9LegacyAckBackfill(markerPresent: boolean): boolean {
  return markerPresent !== true;
}

export function legacyAckBackfillTimestamp(row: {
  accepted_at?: number | null;
  updated_at: number;
  created_at: number;
}): number {
  if (row.accepted_at != null && Number(row.accepted_at) > 0) return Number(row.accepted_at);
  if (row.updated_at != null) return Number(row.updated_at);
  return Number(row.created_at);
}

/**
 * After a successful first-time backfill, new active-unacked rows must stay NULL.
 * Simulates: marker present ⇒ backfill skipped ⇒ unacked row unchanged.
 * Pending rows are never status-promoted by Phase 9 backfill.
 */
export function simulateAckAfterMigrationRerun(args: {
  markerPresentBeforeRerun: boolean;
  row: {
    status: string;
    recipient_acknowledged_at: number | null;
    accepted_at?: number | null;
    updated_at: number;
    created_at: number;
  };
}): number | null {
  if (!shouldRunPhase9LegacyAckBackfill(args.markerPresentBeforeRerun)) {
    return args.row.recipient_acknowledged_at;
  }
  // First-time path only (should not run on rerun):
  if (args.row.status === 'accepted' || args.row.status === 'settled') {
    if (args.row.recipient_acknowledged_at == null) {
      return legacyAckBackfillTimestamp(args.row);
    }
  }
  // pending / other statuses: ack column unchanged (and status not rewritten)
  return args.row.recipient_acknowledged_at;
}

/** Phase 9 backfill must not change operational status of existing rows. */
export function simulateStatusAfterPhase9LegacyBackfill(status: string): string {
  return status;
}

/** Server raises cannot_reject_with_payments when confirmed total > 0. */
export function rejectBlockedByConfirmedPayments(confirmedPaymentTotal: number): boolean {
  return Number(confirmedPaymentTotal) > 0;
}

/**
 * Reverse IOU created by confirm_iou_payment on overpayment:
 * confirming creditor becomes debtor and has explicitly consented via confirm
 * → insert with recipient_acknowledged_at set (not awaiting).
 */
export function reverseOverpaymentIouAcknowledgedAtCreate(): boolean {
  return true;
}

export function isOverpaymentReverseDescription(description?: string | null): boolean {
  return typeof description === 'string' && description.startsWith('[Overpayment]');
}

/** Notify creator only when transitioning from unacked → acked. */
export function shouldEmitAcknowledgementNotification(args: {
  priorAck: number | null | undefined;
  nextAck: number | null | undefined;
  didTransition: boolean;
}): boolean {
  return (
    args.didTransition === true &&
    (args.priorAck == null || args.priorAck === undefined) &&
    args.nextAck != null &&
    Number(args.nextAck) > 0
  );
}
