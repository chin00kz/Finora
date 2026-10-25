import { db } from '../db/db';
import type { Transaction } from '../db/db';
import { createId } from './createId';
import { applyAccountBalanceDeltas, prepareApplyBalance } from './accountBalanceEffects';
import {
  findSelfTransferConflicts,
  transferBecomesSelfTransfer,
  type SelfTransferConflict,
} from './accountDeleteConflicts';
import type { AccountLinkCounts } from './accountDeletePlanHelpers';
import { deleteFromCloud, triggerSync } from '../sync/syncEngine';

export type { SelfTransferConflict };
export { findSelfTransferConflicts };

export interface AccountDeletePlan {
  deletedAccountId: string;
  replacementAccountId: string;
  transactionCount: number;
  recurringCount: number;
  goalLinkCount: number;
  settlementRefCount: number;
  outboxCount: number;
  balanceToMerge: number;
  conflicts: SelfTransferConflict[];
}

/** Count links/balance for an account without requiring a replacement (sole-account checks). */
export async function getAccountLinkCounts(accountId: string): Promise<AccountLinkCounts> {
  const acc = await db.accounts.get(accountId);
  if (!acc) throw new Error('Account to delete was not found.');

  const allTxns = await db.transactions.toArray();
  let transactionCount = 0;
  for (const t of allTxns) {
    if (t.accountId === accountId || t.toAccountId === accountId) transactionCount++;
  }

  const recurringCount = await db.recurringTransactions
    .filter(r => r.accountId === accountId)
    .count();
  const goalLinkCount = await db.savingsGoals
    .filter(g => g.linkedAccountId === accountId)
    .count();

  let settlementRefCount = 0;
  const debts = await db.debts.toArray();
  for (const d of debts) {
    for (const s of d.settlements || []) {
      if (s.accountId === accountId) settlementRefCount++;
    }
  }

  const outboxCount = await db.pendingAccountOutbox
    .filter(o => o.accountId === accountId)
    .count();

  return {
    transactionCount,
    recurringCount,
    goalLinkCount,
    settlementRefCount,
    outboxCount,
    balanceToMerge: acc.balance,
  };
}

/**
 * Balance policy for delete + reassign:
 * - Rewrite historical refs from deleted → replacement (amounts unchanged).
 * - Add deleted.balance onto replacement.balance, then remove deleted account.
 * - Do NOT reverse/re-apply individual transactions (that would double-count).
 * - Block if any transfer is solely between deleted and replacement (would become self-transfer).
 */
export async function planAccountDeletion(
  deletedAccountId: string,
  replacementAccountId: string,
): Promise<AccountDeletePlan> {
  if (!deletedAccountId || !replacementAccountId) {
    throw new Error('Both accounts are required.');
  }
  if (deletedAccountId === replacementAccountId) {
    throw new Error('Choose a different replacement account.');
  }

  const deleted = await db.accounts.get(deletedAccountId);
  const replacement = await db.accounts.get(replacementAccountId);
  if (!deleted) throw new Error('Account to delete was not found.');
  if (!replacement) throw new Error('Replacement account was not found.');

  const allTxns = await db.transactions.toArray();
  let transactionCount = 0;
  for (const t of allTxns) {
    if (t.accountId === deletedAccountId || t.toAccountId === deletedAccountId) {
      transactionCount++;
    }
  }
  const conflicts = findSelfTransferConflicts(allTxns, deletedAccountId, replacementAccountId);

  const recurring = await db.recurringTransactions
    .filter(r => r.accountId === deletedAccountId)
    .toArray();
  const goals = await db.savingsGoals
    .filter(g => g.linkedAccountId === deletedAccountId)
    .toArray();

  let settlementRefCount = 0;
  const debts = await db.debts.toArray();
  for (const d of debts) {
    for (const s of d.settlements || []) {
      if (s.accountId === deletedAccountId) settlementRefCount++;
    }
  }

  const outbox = await db.pendingAccountOutbox
    .filter(o => o.accountId === deletedAccountId)
    .toArray();

  return {
    deletedAccountId,
    replacementAccountId,
    transactionCount,
    recurringCount: recurring.length,
    goalLinkCount: goals.length,
    settlementRefCount,
    outboxCount: outbox.length,
    balanceToMerge: deleted.balance,
    conflicts,
  };
}

/**
 * Execute delete+reassign after planAccountDeletion. Throws if conflicts remain.
 */
export async function executeAccountDeletion(plan: AccountDeletePlan): Promise<void> {
  if (plan.conflicts.length > 0) {
    throw new Error(
      `Cannot delete: ${plan.conflicts.length} transfer(s) between these accounts would become self-transfers. Edit or delete those transfers first.`,
    );
  }

  const { deletedAccountId, replacementAccountId } = plan;
  const touchedTxnIds: string[] = [];
  const touchedRecurringIds: string[] = [];
  const touchedGoalIds: string[] = [];
  const touchedDebtIds: string[] = [];

  await db.transaction(
    'rw',
    [
      db.accounts,
      db.transactions,
      db.recurringTransactions,
      db.savingsGoals,
      db.debts,
      db.pendingAccountOutbox,
    ],
    async () => {
      const deleted = await db.accounts.get(deletedAccountId);
      const replacement = await db.accounts.get(replacementAccountId);
      if (!deleted || !replacement) {
        throw new Error('Account no longer available.');
      }

      const now = Date.now();
      const allTxns = await db.transactions.toArray();
      for (const t of allTxns) {
        let changed = false;
        const patch: Partial<Transaction> = { updatedAt: now };
        if (t.accountId === deletedAccountId) {
          patch.accountId = replacementAccountId;
          changed = true;
        }
        if (t.toAccountId === deletedAccountId) {
          patch.toAccountId = replacementAccountId;
          changed = true;
        }
        if (changed) {
          // Guard: never write a self-transfer (rolls back whole Dexie transaction)
          if (transferBecomesSelfTransfer(t, deletedAccountId, replacementAccountId)) {
            throw new Error(`Transfer ${t.id} would become a self-transfer.`);
          }
          await db.transactions.update(t.id, patch);
          touchedTxnIds.push(t.id);
        }
      }

      const recurring = await db.recurringTransactions
        .filter(r => r.accountId === deletedAccountId)
        .toArray();
      for (const r of recurring) {
        await db.recurringTransactions.update(r.id, {
          accountId: replacementAccountId,
          updatedAt: now,
        });
        touchedRecurringIds.push(r.id);
      }

      const goals = await db.savingsGoals
        .filter(g => g.linkedAccountId === deletedAccountId)
        .toArray();
      for (const g of goals) {
        await db.savingsGoals.update(g.id, {
          linkedAccountId: replacementAccountId,
          updatedAt: now,
        });
        touchedGoalIds.push(g.id);
      }

      const debts = await db.debts.toArray();
      for (const d of debts) {
        if (!d.settlements?.length) continue;
        let changed = false;
        const settlements = d.settlements.map(s => {
          if (s.accountId !== deletedAccountId) return s;
          changed = true;
          return { ...s, accountId: replacementAccountId };
        });
        if (changed) {
          await db.debts.update(d.id, { settlements, updatedAt: now });
          touchedDebtIds.push(d.id);
        }
      }

      const outbox = await db.pendingAccountOutbox
        .filter(o => o.accountId === deletedAccountId)
        .toArray();
      for (const o of outbox) {
        await db.pendingAccountOutbox.put({ ...o, accountId: replacementAccountId });
      }

      await db.accounts.update(replacementAccountId, {
        balance: replacement.balance + deleted.balance,
        updatedAt: now,
      });
      await db.accounts.delete(deletedAccountId);
    },
  );

  await deleteFromCloud('accounts', deletedAccountId);
  triggerSync('accounts', replacementAccountId);
  touchedTxnIds.forEach(id => triggerSync('transactions', id));
  touchedRecurringIds.forEach(id => triggerSync('recurring_transactions', id));
  touchedGoalIds.forEach(id => triggerSync('savings_goals', id));
  touchedDebtIds.forEach(id => triggerSync('debts', id));
}

/** Create account at zero, then apply opening_balance once (no double apply). */
export async function createAccountWithOpeningBalance(input: {
  name: string;
  type: import('../db/db').AccountType;
  openingBalance: number;
  includeInTotal: boolean;
}): Promise<{ accountId: string; openingTxnId?: string }> {
  const accountId = createId('acc');
  const now = Date.now();
  const opening = Number(input.openingBalance) || 0;
  let openingTxnId: string | undefined;

  await db.transaction('rw', [db.accounts, db.transactions], async () => {
    await db.accounts.add({
      id: accountId,
      name: input.name,
      type: input.type,
      balance: 0,
      currency: 'LKR',
      includeInTotal: input.includeInTotal,
      updatedAt: now,
    });

    if (opening !== 0) {
      openingTxnId = createId('txn-ob');
      const balanceTxn = {
        type: 'opening_balance' as const,
        amount: opening,
        accountId,
      };
      const deltas = await prepareApplyBalance(balanceTxn);
      await db.transactions.add({
        id: openingTxnId,
        type: 'opening_balance',
        amount: opening,
        date: now,
        accountId,
        notes: 'Opening balance',
        updatedAt: now,
      });
      await applyAccountBalanceDeltas(deltas, { now, requireAllAccounts: true });
    }
  });

  triggerSync('accounts', accountId);
  if (openingTxnId) triggerSync('transactions', openingTxnId);
  return { accountId, openingTxnId };
}

/** Apply a manual balance edit as a signed balance_adjustment (delta = new − old). */
export async function applyManualBalanceAdjustment(input: {
  accountId: string;
  newBalance: number;
  name: string;
  type: import('../db/db').AccountType;
  includeInTotal: boolean;
}): Promise<{ adjustmentTxnId?: string }> {
  const now = Date.now();
  let adjustmentTxnId: string | undefined;

  await db.transaction('rw', [db.accounts, db.transactions], async () => {
    const acc = await db.accounts.get(input.accountId);
    if (!acc) throw new Error('Account not found.');

    const newBalance = Number(input.newBalance);
    if (Number.isNaN(newBalance)) throw new Error('Invalid balance.');

    const delta = newBalance - acc.balance;

    await db.accounts.update(input.accountId, {
      name: input.name,
      type: input.type,
      includeInTotal: input.includeInTotal,
      updatedAt: now,
    });

    if (delta !== 0) {
      adjustmentTxnId = createId('txn-adj');
      const balanceTxn = {
        type: 'balance_adjustment' as const,
        amount: delta,
        accountId: input.accountId,
      };
      const deltas = await prepareApplyBalance(balanceTxn);
      await db.transactions.add({
        id: adjustmentTxnId,
        type: 'balance_adjustment',
        amount: delta,
        date: now,
        accountId: input.accountId,
        notes:
          delta > 0
            ? `Balance adjustment (+${delta.toLocaleString()})`
            : `Balance adjustment (${delta.toLocaleString()})`,
        updatedAt: now,
      });
      await applyAccountBalanceDeltas(deltas, { now, requireAllAccounts: true });
    }
  });

  triggerSync('accounts', input.accountId);
  if (adjustmentTxnId) triggerSync('transactions', adjustmentTxnId);
  return { adjustmentTxnId };
}
