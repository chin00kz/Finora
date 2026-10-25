// src/utils/sharedIouSettlementEngine.ts
import type { CacheSharedIouSettlement } from '../db/db';

export interface SharedIouFinancials {
  confirmedTotal: number;
  pendingTotal: number;
  remainingAmount: number;
  availableToPropose: number;
}

export function getSharedIouSettlementStatus(iouAmount: number, settlements: CacheSharedIouSettlement[]): SharedIouFinancials {
  let confirmedTotal = 0;
  let pendingTotal = 0;

  for (const s of settlements) {
    if (s.status === 'confirmed') {
      confirmedTotal += s.amount;
    } else if (s.status === 'pending') {
      pendingTotal += s.amount;
    }
  }

  const remainingAmount = Math.max(0, iouAmount - confirmedTotal);
  const availableToPropose = Math.max(0, iouAmount - confirmedTotal - pendingTotal);

  return {
    confirmedTotal,
    pendingTotal,
    remainingAmount,
    availableToPropose
  };
}

/**
 * Remaining balance for Mark-as-Paid UI / submit display.
 *
 * UnifiedIou.amount from Debts.tsx is ALREADY the confirmed remaining
 * (original − Σ confirmed). Never subtract confirmed totals from that
 * field again. Prefer recomputing from originalAmount + settlements when
 * originalAmount is present so remaps stay idempotent.
 *
 * Pending settlements do not reduce Mark-as-Paid remaining — only confirmed
 * payments do (matches mark_iou_paid server remaining = amount − confirmed).
 */
export function resolveMarkPaidRemainingAmount(args: {
  /** Cloud principal — UnifiedIou.originalAmount */
  originalAmount?: number;
  /** UnifiedIou.amount — remaining after confirmed settlements, not principal */
  unifiedRemainingAmount: number;
  settlements: Array<Pick<CacheSharedIouSettlement, 'status' | 'amount'>>;
}): number {
  if (args.originalAmount != null && Number.isFinite(args.originalAmount)) {
    return getSharedIouSettlementStatus(
      args.originalAmount,
      args.settlements as CacheSharedIouSettlement[],
    ).remainingAmount;
  }
  return Math.max(0, args.unifiedRemainingAmount);
}

/** True when Mark-as-Paid may submit a settlement for the remaining balance. */
export function canSubmitMarkPaid(remainingAmount: number): boolean {
  return Number.isFinite(remainingAmount) && remainingAmount > 0;
}

export function canProposePayment(
  source: 'local' | 'shared',
  status: 'active' | 'settled' | 'pending' | 'cancelled' | 'rejected',
  direction: 'theyOweMe' | 'iOweThem',
  availableToPropose: number
): boolean {
  return (
    source === 'shared' &&
    status === 'active' &&
    direction === 'iOweThem' &&
    availableToPropose > 0
  );
}

export function canReviewPayment(
  source: 'local' | 'shared',
  status: 'active' | 'settled' | 'pending' | 'cancelled' | 'rejected',
  direction: 'theyOweMe' | 'iOweThem'
): boolean {
  return (
    source === 'shared' &&
    status === 'active' &&
    direction === 'theyOweMe'
  );
}
