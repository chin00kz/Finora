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

export function canProposePayment(
  source: 'local' | 'shared',
  status: 'active' | 'settled' | 'pending',
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
