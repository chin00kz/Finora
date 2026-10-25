/**
 * Shared IOU acknowledgement vs operational usability.
 *
 * Cloud `status = 'accepted'` means the IOU is operationally active (settlements
 * allowed). It does NOT imply the debtor agreed — that is acknowledgement via
 * `recipient_acknowledged_at`:
 * - number > 0 → acknowledged
 * - null → explicitly unacked (phase 9+ create)
 * - undefined → legacy cache row without the column (treat accepted/settled as acked)
 *
 * Reverse overpayment IOUs (`confirm_iou_payment`): inserted with
 * `recipient_acknowledged_at` set because the confirming creditor (now reverse
 * debtor) explicitly consented by confirming the overpay. Not silent ack of a
 * third party.
 */

export interface SharedIouAckFields {
  status: string;
  /** Milliseconds; null = unacked; undefined = field absent (legacy) */
  recipient_acknowledged_at?: number | null;
}

/** Operationally open for settlement actions (not terminal). */
export function isSharedIouOperationallyActive(status: string): boolean {
  return status === 'accepted' || status === 'pending';
}

export function isRecipientAcknowledged(iou: SharedIouAckFields): boolean {
  if (iou.status === 'pending') return false;
  if (iou.status === 'declined' || iou.status === 'cancelled' || iou.status === 'rejected') {
    return false;
  }
  if (iou.recipient_acknowledged_at === null) return false;
  if (typeof iou.recipient_acknowledged_at === 'number' && iou.recipient_acknowledged_at > 0) {
    return true;
  }
  // Legacy accepted/settled without the column in the payload
  return iou.status === 'accepted' || iou.status === 'settled';
}

export type SharedIouAckUiState =
  | 'awaiting_acknowledgement'
  | 'acknowledged'
  | 'rejected'
  | 'declined'
  | 'cancelled'
  | 'settled'
  | 'legacy_pending';

export function getSharedIouAckUiState(iou: SharedIouAckFields): SharedIouAckUiState {
  if (iou.status === 'rejected') return 'rejected';
  if (iou.status === 'declined') return 'declined';
  if (iou.status === 'cancelled') return 'cancelled';
  if (iou.status === 'settled') return 'settled';
  if (iou.status === 'pending') return 'legacy_pending';
  if (iou.status === 'accepted' && !isRecipientAcknowledged(iou)) {
    return 'awaiting_acknowledgement';
  }
  return 'acknowledged';
}

export function getAwaitingAcknowledgementLabel(): string {
  return 'Awaiting recipient acknowledgement';
}

/** Settlement RPCs require cloud status accepted (not pending/rejected/…). */
export function canOperateSettlementsOnSharedIou(status: string): boolean {
  return status === 'accepted';
}

export function canAcknowledgeSharedIou(args: {
  status: string;
  isDebtor: boolean;
  recipientAcknowledged: boolean;
}): boolean {
  if (!args.isDebtor || args.recipientAcknowledged) return false;
  return args.status === 'accepted' || args.status === 'pending';
}

/**
 * Debtor may reject pending or unacked/active IOUs with zero confirmed payments.
 * Mirrors Phase 8 / Phase 9 SQL `cannot_reject_with_payments`.
 */
export function canRejectSharedIou(args: {
  status: string;
  isDebtor: boolean;
  /** Sum of confirmed settlement amounts; > 0 blocks reject (server + UI). */
  confirmedPaymentTotal?: number;
}): boolean {
  if (!args.isDebtor) return false;
  if ((args.confirmedPaymentTotal ?? 0) > 0) return false;
  return args.status === 'accepted' || args.status === 'pending' || args.status === 'active';
}

/**
 * Route debtor dismiss: legacy handshake pending → decline_shared_iou;
 * operational accepted/active → reject_shared_iou (Phase 8+).
 * Matches Debts.tsx handleActionSharedIou.
 */
export function resolveDebtorRejectRpc(
  uiOrCloudStatus: string,
): 'decline_shared_iou' | 'reject_shared_iou' {
  if (uiOrCloudStatus === 'pending') return 'decline_shared_iou';
  return 'reject_shared_iou';
}
