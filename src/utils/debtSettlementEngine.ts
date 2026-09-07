import { db, type Debt, type DebtSettlement, type Transaction } from '../db/db';
import { triggerSync, deleteFromCloud } from '../sync/syncEngine';

/**
 * Calculates total settled amount and remaining balance for a debt.
 */
export function getDebtSettlementStatus(debt: Debt) {
  const settledAmount = (debt.settlements || []).reduce((sum, s) => sum + (s.amount || 0), 0);
  const remainingAmount = Math.max(0, debt.amount - settledAmount);
  const isFullySettled = settledAmount >= debt.amount;
  const progressPercent = debt.amount > 0 ? Math.min(100, Math.round((settledAmount / debt.amount) * 100)) : 100;

  return {
    settledAmount,
    remainingAmount,
    isFullySettled,
    progressPercent,
  };
}

/**
 * Record a full or partial settlement for a debt.
 */
export async function recordDebtSettlement({
  debtId,
  amount,
  method,
  accountId,
  date,
  note,
}: {
  debtId: string;
  amount: number;
  method: 'account' | 'exclude';
  accountId?: string;
  date: number;
  note?: string;
}): Promise<{ success: boolean; error?: string; settlementId?: string }> {
  try {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      return { success: false, error: 'Settlement amount must be greater than zero.' };
    }

    const debt = await db.debts.get(debtId);
    if (!debt) {
      return { success: false, error: 'Debt not found.' };
    }

    const { remainingAmount } = getDebtSettlementStatus(debt);
    if (numAmount > remainingAmount + 0.0001) {
      return { success: false, error: `Amount exceeds remaining balance of ${remainingAmount.toLocaleString()}` };
    }

    const now = Date.now();
    const settlementId = `ds-${now}-${Math.random().toString(36).substring(2, 7)}`;
    let createdTxnId: string | undefined = undefined;

    await db.transaction('rw', [db.debts, db.accounts, db.transactions], async () => {
      // 1. If method is 'account', update account balance and create budget-neutral transaction
      if (method === 'account' && accountId) {
        const acc = await db.accounts.get(accountId);
        if (acc) {
          // If they owe me, money comes IN (balance increases).
          // If I owe them, money goes OUT (balance decreases).
          const balanceDelta = debt.direction === 'theyOweMe' ? numAmount : -numAmount;
          await db.accounts.update(accountId, {
            balance: acc.balance + balanceDelta,
            updatedAt: now,
          });

          createdTxnId = `txn-ds-${now}-${Math.random().toString(36).substring(2, 6)}`;
          await db.transactions.add({
            id: createdTxnId,
            type: 'debt_settlement',
            amount: numAmount,
            date: date || now,
            accountId,
            notes: note ? `${note} (${debt.personName})` : `Debt settlement: ${debt.personName}`,
            debtId: debt.id,
            debtDirection: debt.direction,
            debtSettlementId: settlementId,
            updatedAt: now,
          });
        }
      }

      // 2. Append settlement event to debt history
      const newSettlement: DebtSettlement = {
        id: settlementId,
        amount: numAmount,
        method,
        accountId: method === 'account' ? accountId : undefined,
        date: date || now,
        note: note ? note.trim() : undefined,
        transactionId: createdTxnId,
      };

      const updatedSettlements = [...(debt.settlements || []), newSettlement];
      const newSettledTotal = updatedSettlements.reduce((sum, s) => sum + s.amount, 0);
      const isFullySettled = newSettledTotal >= debt.amount;

      await db.debts.update(debt.id, {
        settlements: updatedSettlements,
        updatedAt: now,
      });

      // 3. If this was a shared expense, keep relatedTransaction.isSettled in sync
      if (debt.source === 'shared_expense' && debt.relatedTransactionId) {
        await db.transactions.update(debt.relatedTransactionId, {
          isSettled: isFullySettled,
          updatedAt: now,
        });
      }
    });

    triggerSync();
    return { success: true, settlementId };
  } catch (err: any) {
    console.error('Failed to record debt settlement', err);
    return { success: false, error: err?.message || 'Failed to record settlement.' };
  }
}

/**
 * Undo / Delete a single settlement event from a debt.
 */
export async function undoDebtSettlement(
  debtId: string,
  settlementId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const debt = await db.debts.get(debtId);
    if (!debt) return { success: false, error: 'Debt not found.' };

    const settlement = (debt.settlements || []).find(s => s.id === settlementId);
    if (!settlement) return { success: false, error: 'Settlement event not found.' };

    const now = Date.now();

    await db.transaction('rw', [db.debts, db.accounts, db.transactions], async () => {
      // 1. Revert account balance if it was account-linked
      if (settlement.method === 'account' && settlement.accountId) {
        const acc = await db.accounts.get(settlement.accountId);
        if (acc) {
          // Invert delta: if theyOweMe (previously added), now subtract.
          // If iOweThem (previously subtracted), now add back.
          const reverseDelta = debt.direction === 'theyOweMe' ? -settlement.amount : settlement.amount;
          await db.accounts.update(settlement.accountId, {
            balance: acc.balance + reverseDelta,
            updatedAt: now,
          });
        }
      }

      // 2. Remove linked transaction if one was created
      if (settlement.transactionId) {
        await db.transactions.delete(settlement.transactionId);
        await deleteFromCloud('transactions', settlement.transactionId);
      }

      // 3. Remove settlement from debt history
      const updatedSettlements = (debt.settlements || []).filter(s => s.id !== settlementId);
      const newSettledTotal = updatedSettlements.reduce((sum, s) => sum + s.amount, 0);
      const isFullySettled = newSettledTotal >= debt.amount;

      await db.debts.update(debt.id, {
        settlements: updatedSettlements,
        updatedAt: now,
      });

      // 4. Update related transaction if shared expense
      if (debt.source === 'shared_expense' && debt.relatedTransactionId) {
        await db.transactions.update(debt.relatedTransactionId, {
          isSettled: isFullySettled,
          updatedAt: now,
        });
      }
    });

    triggerSync();
    return { success: true };
  } catch (err: any) {
    console.error('Failed to undo debt settlement', err);
    return { success: false, error: err?.message || 'Failed to undo settlement.' };
  }
}

/**
 * Clean up a debt settlement if its linked transaction is deleted from Activity or elsewhere.
 */
export async function syncSettlementFromTransactionDelete(txn: Transaction): Promise<void> {
  if (txn.type !== 'debt_settlement' || !txn.debtId) return;

  try {
    const debt = await db.debts.get(txn.debtId);
    if (!debt || !debt.settlements) return;

    const settlement = debt.settlements.find(
      s => s.transactionId === txn.id || (txn.debtSettlementId && s.id === txn.debtSettlementId)
    );
    if (!settlement) return;

    const now = Date.now();
    const updatedSettlements = debt.settlements.filter(s => s.id !== settlement.id);
    const newSettledTotal = updatedSettlements.reduce((sum, s) => sum + s.amount, 0);
    const isFullySettled = newSettledTotal >= debt.amount;

    await db.debts.update(debt.id, {
      settlements: updatedSettlements,
      updatedAt: now,
    });

    if (debt.source === 'shared_expense' && debt.relatedTransactionId) {
      await db.transactions.update(debt.relatedTransactionId, {
        isSettled: isFullySettled,
        updatedAt: now,
      });
    }

    triggerSync();
  } catch (err) {
    console.error('Failed to sync debt settlement after transaction delete', err);
  }
}

/**
 * Update a debt settlement when its linked transaction is edited in TransactionEditSheet.
 */
export async function syncSettlementFromTransactionEdit(
  txn: Transaction,
  newAmount: number,
  newAccountId: string,
  newNotes?: string
): Promise<void> {
  if (txn.type !== 'debt_settlement' || !txn.debtId) return;

  try {
    const debt = await db.debts.get(txn.debtId);
    if (!debt || !debt.settlements) return;

    const settlementIndex = debt.settlements.findIndex(
      s => s.transactionId === txn.id || (txn.debtSettlementId && s.id === txn.debtSettlementId)
    );
    if (settlementIndex === -1) return;

    const now = Date.now();
    const updatedSettlements = [...debt.settlements];
    updatedSettlements[settlementIndex] = {
      ...updatedSettlements[settlementIndex],
      amount: newAmount,
      accountId: newAccountId,
      note: newNotes !== undefined ? newNotes : updatedSettlements[settlementIndex].note,
    };

    const newSettledTotal = updatedSettlements.reduce((sum, s) => sum + s.amount, 0);
    const isFullySettled = newSettledTotal >= debt.amount;

    await db.debts.update(debt.id, {
      settlements: updatedSettlements,
      updatedAt: now,
    });

    if (debt.source === 'shared_expense' && debt.relatedTransactionId) {
      await db.transactions.update(debt.relatedTransactionId, {
        isSettled: isFullySettled,
        updatedAt: now,
      });
    }

    triggerSync();
  } catch (err) {
    console.error('Failed to sync debt settlement after transaction edit', err);
  }
}

/**
 * Automatically bridges existing and new shared expenses into db.debts
 * so they appear seamlessly in the IOUs system.
 */
export async function reconcileSharedExpenses(): Promise<void> {
  try {
    const sharedTxns = await db.transactions
      .filter(t => Boolean(t.isShared && t.personalAmount !== undefined && t.amount > t.personalAmount))
      .toArray();

    if (sharedTxns.length === 0) return;

    const existingDebts = await db.debts.toArray();
    const existingRelatedTxnIds = new Set(
      existingDebts.filter(d => Boolean(d.relatedTransactionId)).map(d => d.relatedTransactionId!)
    );

    const now = Date.now();
    const debtsToAdd: Debt[] = [];

    for (const txn of sharedTxns) {
      if (!existingRelatedTxnIds.has(txn.id)) {
        const othersShare = txn.amount - (txn.personalAmount || 0);
        const isSettled = Boolean(txn.isSettled);

        const initialSettlements: DebtSettlement[] = isSettled
          ? [
              {
                id: `ds-legacy-${txn.id}`,
                amount: othersShare,
                method: 'exclude',
                date: txn.date,
                note: 'Settled previously',
              },
            ]
          : [];

        debtsToAdd.push({
          id: `debt-${txn.id}`,
          source: 'shared_expense',
          direction: 'theyOweMe',
          personName: txn.notes ? txn.notes.slice(0, 30) : 'Shared Expense',
          amount: othersShare,
          note: txn.notes || 'Shared expense split',
          date: txn.date,
          relatedTransactionId: txn.id,
          settlements: initialSettlements,
          updatedAt: now,
        });
      }
    }

    if (debtsToAdd.length > 0) {
      await db.debts.bulkAdd(debtsToAdd);
      triggerSync();
    }
  } catch (err) {
    console.error('Failed to reconcile shared expenses', err);
  }
}
