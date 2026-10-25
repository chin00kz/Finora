import type { Transaction } from '../db/db';

export interface SelfTransferConflict {
  id: string;
  amount: number;
  date: number;
  notes?: string;
  direction: 'from_deleted' | 'to_deleted';
}

/** Account IDs after rewriting deleted → replacement. */
export function remapAccountId(
  accountId: string | undefined,
  deletedAccountId: string,
  replacementAccountId: string,
): string | undefined {
  if (!accountId) return accountId;
  return accountId === deletedAccountId ? replacementAccountId : accountId;
}

/**
 * Pure check: after reassignment, would this transfer become a self-transfer?
 * Covers deleted↔replacement and historical self-transfers on the deleted account.
 */
export function transferBecomesSelfTransfer(
  txn: Pick<Transaction, 'type' | 'accountId' | 'toAccountId'>,
  deletedAccountId: string,
  replacementAccountId: string,
): boolean {
  if (txn.type !== 'transfer' || !txn.toAccountId) return false;
  const nextFrom = remapAccountId(txn.accountId, deletedAccountId, replacementAccountId);
  const nextTo = remapAccountId(txn.toAccountId, deletedAccountId, replacementAccountId);
  return !!nextFrom && !!nextTo && nextFrom === nextTo;
}

/**
 * Transfers that would become self-transfers if deleted is remapped onto replacement.
 */
export function findSelfTransferConflicts(
  txns: Array<
    Pick<Transaction, 'id' | 'type' | 'amount' | 'date' | 'notes' | 'accountId' | 'toAccountId'>
  >,
  deletedAccountId: string,
  replacementAccountId: string,
): SelfTransferConflict[] {
  const conflicts: SelfTransferConflict[] = [];
  for (const t of txns) {
    if (!transferBecomesSelfTransfer(t, deletedAccountId, replacementAccountId)) continue;
    // Only surface conflicts involving the deleted account (not unrelated replacement self-transfers)
    const touchesDeleted =
      t.accountId === deletedAccountId || t.toAccountId === deletedAccountId;
    if (!touchesDeleted) continue;

    conflicts.push({
      id: t.id,
      amount: t.amount,
      date: t.date,
      notes: t.notes,
      direction: t.accountId === deletedAccountId ? 'from_deleted' : 'to_deleted',
    });
  }
  return conflicts;
}
