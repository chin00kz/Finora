/**
 * Reverse a just-created transaction from the global undo toast.
 * Uses shared reverse helpers inside one Dexie rw transaction so a partial
 * failure cannot leave the txn deleted with balances unrestored (or vice versa).
 */
import { db } from '../db/db';
import {
  applyAccountBalanceDeltas,
  computeReverseBalanceDeltas,
} from './accountBalanceEffects';

export type UndoToastTxnType = 'expense' | 'income';

export interface UndoRecentTransactionInput {
  transactionId: string;
  /** Expected type from toast (defensive check against stale toast). */
  expectedType?: UndoToastTxnType;
}

export interface UndoRecentTransactionResult {
  ok: boolean;
  reason?: 'not_found' | 'type_mismatch' | 'no_balance_effect';
  reversedAccountIds: string[];
}

/**
 * Pure: whether a stored txn type is safe for the expense/income undo toast.
 * Transfers and balance-history types must use edit-sheet delete instead.
 */
export function isUndoToastSupportedType(type: string): type is UndoToastTxnType {
  return type === 'expense' || type === 'income';
}

/**
 * Reverse balances then delete the transaction atomically.
 * Caller handles cloud delete / dirty cleanup after success.
 */
export async function undoRecentTransaction(
  input: UndoRecentTransactionInput,
): Promise<UndoRecentTransactionResult> {
  const reversedAccountIds: string[] = [];

  const result = await db.transaction('rw', db.transactions, db.accounts, async () => {
    const txn = await db.transactions.get(input.transactionId);
    if (!txn) {
      return { ok: false as const, reason: 'not_found' as const, reversedAccountIds };
    }
    if (!isUndoToastSupportedType(txn.type)) {
      return { ok: false as const, reason: 'type_mismatch' as const, reversedAccountIds };
    }
    if (input.expectedType && txn.type !== input.expectedType) {
      return { ok: false as const, reason: 'type_mismatch' as const, reversedAccountIds };
    }

    const deltas = computeReverseBalanceDeltas(txn);
    if (deltas.size === 0) {
      return { ok: false as const, reason: 'no_balance_effect' as const, reversedAccountIds };
    }

    // Reverse first, then delete — matches TransactionEditSheet delete order.
    await applyAccountBalanceDeltas(deltas, { requireAllAccounts: false });
    for (const id of deltas.keys()) reversedAccountIds.push(id);
    await db.transactions.delete(input.transactionId);

    return { ok: true as const, reversedAccountIds };
  });

  return result;
}
