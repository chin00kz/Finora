import { db } from '../db/db';
import { format } from 'date-fns';
import { triggerSync } from '../sync/syncEngine';

export interface FinoraFullBackup {
  version: number;
  exportedAt: number;
  app: 'Finora';
  data: {
    accounts: unknown[];
    categories: unknown[];
    transactions: unknown[];
    budgets: unknown[];
    tags: unknown[];
    people: unknown[];
    debts: unknown[];
    recurringTransactions: unknown[];
    savingsGoals: unknown[];
    creditCards: unknown[];
    cashOffsetSources: unknown[];
    fixedDeposits: unknown[];
    moneyMarketAccounts: unknown[];
    installmentPlans: unknown[];
    cardPromos: unknown[];
    floatGapHistory: unknown[];
    reimbursementLedgers: unknown[];
    reimbursementEntries: unknown[];
  };
}

/**
 * Exports all 18 IndexedDB tables into a single comprehensive JSON file.
 */
export async function exportFullBackupJSON(): Promise<void> {
  const [
    accounts,
    categories,
    transactions,
    budgets,
    tags,
    people,
    debts,
    recurringTransactions,
    savingsGoals,
    creditCards,
    cashOffsetSources,
    fixedDeposits,
    moneyMarketAccounts,
    installmentPlans,
    cardPromos,
    floatGapHistory,
    reimbursementLedgers,
    reimbursementEntries,
  ] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.tags.toArray(),
    db.people.toArray(),
    db.debts.toArray(),
    db.recurringTransactions.toArray(),
    db.savingsGoals.toArray(),
    db.creditCards.toArray(),
    db.cashOffsetSources.toArray(),
    db.fixedDeposits.toArray(),
    db.moneyMarketAccounts.toArray(),
    db.installmentPlans.toArray(),
    db.cardPromos.toArray(),
    db.floatGapHistory.toArray(),
    db.reimbursementLedgers.toArray(),
    db.reimbursementEntries.toArray(),
  ]);

  const backup: FinoraFullBackup = {
    version: 1,
    exportedAt: Date.now(),
    app: 'Finora',
    data: {
      accounts,
      categories,
      transactions,
      budgets,
      tags,
      people,
      debts,
      recurringTransactions,
      savingsGoals,
      creditCards,
      cashOffsetSources,
      fixedDeposits,
      moneyMarketAccounts,
      installmentPlans,
      cardPromos,
      floatGapHistory,
      reimbursementLedgers,
      reimbursementEntries,
    },
  };

  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `finora_complete_backup_${format(new Date(), 'yyyyMMdd_HHmm')}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Restores a full backup JSON file into IndexedDB.
 */
export async function restoreFullBackupJSON(jsonString: string): Promise<{ success: boolean; error?: string; restoredCount: number }> {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || parsed.app !== 'Finora' || !parsed.data) {
      return { success: false, error: 'Invalid backup file. Must be a Finora backup JSON.', restoredCount: 0 };
    }

    const { data } = parsed as FinoraFullBackup;
    let totalItems = 0;

    await db.transaction('rw', [
      db.accounts,
      db.categories,
      db.transactions,
      db.budgets,
      db.tags,
      db.people,
      db.debts,
      db.recurringTransactions,
      db.savingsGoals,
      db.creditCards,
      db.cashOffsetSources,
      db.fixedDeposits,
      db.moneyMarketAccounts,
      db.installmentPlans,
      db.cardPromos,
      db.floatGapHistory,
      db.reimbursementLedgers,
      db.reimbursementEntries,
    ], async () => {
      if (Array.isArray(data.accounts) && data.accounts.length) {
        await db.accounts.bulkPut(data.accounts as any);
        totalItems += data.accounts.length;
      }
      if (Array.isArray(data.categories) && data.categories.length) {
        await db.categories.bulkPut(data.categories as any);
        totalItems += data.categories.length;
      }
      if (Array.isArray(data.transactions) && data.transactions.length) {
        await db.transactions.bulkPut(data.transactions as any);
        totalItems += data.transactions.length;
      }
      if (Array.isArray(data.budgets) && data.budgets.length) {
        await db.budgets.bulkPut(data.budgets as any);
        totalItems += data.budgets.length;
      }
      if (Array.isArray(data.tags) && data.tags.length) {
        await db.tags.bulkPut(data.tags as any);
        totalItems += data.tags.length;
      }
      if (Array.isArray(data.people) && data.people.length) {
        await db.people.bulkPut(data.people as any);
        totalItems += data.people.length;
      }
      if (Array.isArray(data.debts) && data.debts.length) {
        await db.debts.bulkPut(data.debts as any);
        totalItems += data.debts.length;
      }
      if (Array.isArray(data.recurringTransactions) && data.recurringTransactions.length) {
        await db.recurringTransactions.bulkPut(data.recurringTransactions as any);
        totalItems += data.recurringTransactions.length;
      }
      if (Array.isArray(data.savingsGoals) && data.savingsGoals.length) {
        await db.savingsGoals.bulkPut(data.savingsGoals as any);
        totalItems += data.savingsGoals.length;
      }
      if (Array.isArray(data.creditCards) && data.creditCards.length) {
        await db.creditCards.bulkPut(data.creditCards as any);
        totalItems += data.creditCards.length;
      }
      if (Array.isArray(data.cashOffsetSources) && data.cashOffsetSources.length) {
        await db.cashOffsetSources.bulkPut(data.cashOffsetSources as any);
        totalItems += data.cashOffsetSources.length;
      }
      if (Array.isArray(data.fixedDeposits) && data.fixedDeposits.length) {
        await db.fixedDeposits.bulkPut(data.fixedDeposits as any);
        totalItems += data.fixedDeposits.length;
      }
      if (Array.isArray(data.moneyMarketAccounts) && data.moneyMarketAccounts.length) {
        await db.moneyMarketAccounts.bulkPut(data.moneyMarketAccounts as any);
        totalItems += data.moneyMarketAccounts.length;
      }
      if (Array.isArray(data.installmentPlans) && data.installmentPlans.length) {
        await db.installmentPlans.bulkPut(data.installmentPlans as any);
        totalItems += data.installmentPlans.length;
      }
      if (Array.isArray(data.cardPromos) && data.cardPromos.length) {
        await db.cardPromos.bulkPut(data.cardPromos as any);
        totalItems += data.cardPromos.length;
      }
      if (Array.isArray(data.floatGapHistory) && data.floatGapHistory.length) {
        await db.floatGapHistory.bulkPut(data.floatGapHistory as any);
        totalItems += data.floatGapHistory.length;
      }
      if (Array.isArray(data.reimbursementLedgers) && data.reimbursementLedgers.length) {
        await db.reimbursementLedgers.bulkPut(data.reimbursementLedgers as any);
        totalItems += data.reimbursementLedgers.length;
      }
      if (Array.isArray(data.reimbursementEntries) && data.reimbursementEntries.length) {
        await db.reimbursementEntries.bulkPut(data.reimbursementEntries as any);
        totalItems += data.reimbursementEntries.length;
      }
    });

    triggerSync();
    return { success: true, restoredCount: totalItems };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown restore error', restoredCount: 0 };
  }
}

