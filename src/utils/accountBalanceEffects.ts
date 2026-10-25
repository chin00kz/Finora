import { db } from '../db/db';
import type { Transaction } from '../db/db';

export type BalanceTxn = Pick<
  Transaction,
  'type' | 'amount' | 'accountId' | 'toAccountId' | 'debtDirection'
>;

function addDelta(deltas: Map<string, number>, accountId: string, delta: number) {
  if (!accountId) return;
  deltas.set(accountId, (deltas.get(accountId) ?? 0) + delta);
}

function isSignedBalanceType(type: BalanceTxn['type']): boolean {
  return type === 'opening_balance' || type === 'balance_adjustment';
}

/**
 * Cash-effect deltas when applying (creating) a transaction.
 * Positive = credit account; negative = debit.
 * opening_balance / balance_adjustment use signed amount.
 */
export function computeApplyBalanceDeltas(txn: BalanceTxn): Map<string, number> {
  const deltas = new Map<string, number>();

  if (txn.type === 'expense') {
    addDelta(deltas, txn.accountId, -txn.amount);
  } else if (txn.type === 'income') {
    addDelta(deltas, txn.accountId, txn.amount);
  } else if (txn.type === 'transfer' && txn.toAccountId) {
    addDelta(deltas, txn.accountId, -txn.amount);
    addDelta(deltas, txn.toAccountId, txn.amount);
  } else if (txn.type === 'debt_settlement') {
    addDelta(
      deltas,
      txn.accountId,
      txn.debtDirection === 'theyOweMe' ? txn.amount : -txn.amount,
    );
  } else if (isSignedBalanceType(txn.type)) {
    addDelta(deltas, txn.accountId, txn.amount);
  }

  return deltas;
}

/**
 * Cash-effect deltas when reversing (deleting) a transaction.
 * Transfer reverses both sides whenever toAccountId is set.
 */
export function computeReverseBalanceDeltas(txn: BalanceTxn): Map<string, number> {
  const deltas = new Map<string, number>();

  if (txn.type === 'expense') {
    addDelta(deltas, txn.accountId, txn.amount);
  } else if (txn.type === 'income') {
    addDelta(deltas, txn.accountId, -txn.amount);
  } else if (txn.type === 'transfer' && txn.toAccountId) {
    addDelta(deltas, txn.accountId, txn.amount);
    addDelta(deltas, txn.toAccountId, -txn.amount);
  } else if (txn.type === 'debt_settlement') {
    addDelta(
      deltas,
      txn.accountId,
      txn.debtDirection === 'theyOweMe' ? -txn.amount : txn.amount,
    );
  } else if (isSignedBalanceType(txn.type)) {
    addDelta(deltas, txn.accountId, -txn.amount);
  }

  return deltas;
}

/** Account IDs that must exist before a create/apply may proceed. */
export function requiredAccountIdsForApply(txn: BalanceTxn): string[] {
  if (txn.type === 'transfer') {
    if (!txn.accountId || !txn.toAccountId) return [];
    if (txn.accountId === txn.toAccountId) return [];
    return [txn.accountId, txn.toAccountId];
  }
  if (!txn.accountId) return [];
  return [txn.accountId];
}

/**
 * Validate accounts for create/apply. Returns an error message, or null if OK.
 */
export function validateAccountsForApply(txn: BalanceTxn): string | null {
  if (Number.isNaN(txn.amount)) {
    return 'Amount must be a valid number.';
  }
  if (isSignedBalanceType(txn.type)) {
    if (txn.amount === 0) return 'Amount must be non-zero.';
  } else if (!txn.amount || txn.amount <= 0) {
    return 'Amount must be greater than zero.';
  }
  if (txn.type === 'transfer') {
    if (!txn.accountId) return 'Source account is required.';
    if (!txn.toAccountId) return 'Destination account is required.';
    if (txn.accountId === txn.toAccountId) {
      return 'Source and destination accounts must be different.';
    }
    return null;
  }
  if (!txn.accountId) return 'Account is required.';
  return null;
}

/** Throw if any required account row is missing (for atomic create/apply). */
export async function assertAccountsExist(accountIds: string[]): Promise<void> {
  const unique = [...new Set(accountIds.filter(Boolean))];
  for (const id of unique) {
    const acc = await db.accounts.get(id);
    if (!acc) {
      throw new Error(`Account not found: ${id}`);
    }
  }
}

/**
 * Apply deltas. If requireAllAccounts is true (create/apply), missing accounts throw
 * so the surrounding Dexie transaction rolls back. If false (reverse/delete), missing
 * accounts are skipped so a transfer can still reverse the remaining side.
 */
export async function applyAccountBalanceDeltas(
  deltas: Map<string, number>,
  options: { now?: number; requireAllAccounts?: boolean } = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  const requireAll = options.requireAllAccounts ?? true;

  for (const [accountId, delta] of deltas) {
    if (delta === 0) continue;
    const acc = await db.accounts.get(accountId);
    if (!acc) {
      if (requireAll) {
        throw new Error(`Account not found: ${accountId}`);
      }
      continue;
    }
    await db.accounts.update(accountId, {
      balance: acc.balance + delta,
      updatedAt: now,
    });
  }
}

/** Validate + assert existence for create/apply paths. */
export async function prepareApplyBalance(txn: BalanceTxn): Promise<Map<string, number>> {
  const validationError = validateAccountsForApply(txn);
  if (validationError) throw new Error(validationError);

  const required = requiredAccountIdsForApply(txn);
  if (required.length === 0) {
    throw new Error('Valid account references are required.');
  }
  await assertAccountsExist(required);

  const deltas = computeApplyBalanceDeltas(txn);
  if (deltas.size === 0) {
    throw new Error('Transaction has no balance effect.');
  }
  return deltas;
}
