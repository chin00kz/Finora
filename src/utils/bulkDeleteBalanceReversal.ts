import type { Transaction } from '../db/db';
import { computeReverseBalanceDeltas } from './accountBalanceEffects';

type BulkDeleteTxn = Pick<
  Transaction,
  'type' | 'amount' | 'accountId' | 'toAccountId' | 'debtDirection'
>;

/**
 * Net account balance deltas that reverse the original effects of transactions
 * being bulk-deleted. Positive = credit the account; negative = debit.
 */
export function computeBulkDeleteBalanceDeltas(txns: BulkDeleteTxn[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const txn of txns) {
    for (const [accountId, delta] of computeReverseBalanceDeltas(txn)) {
      deltas.set(accountId, (deltas.get(accountId) ?? 0) + delta);
    }
  }
  return deltas;
}
