import { db } from '../db/db';

/**
 * Removes duplicate categories from IndexedDB.
 * Groups by (name, type) and keeps the entry with the latest updatedAt.
 * Any transactions pointing to a removed duplicate are re-pointed to the survivor.
 */
export async function deduplicateCategories(): Promise<void> {
  const all = await db.categories.toArray();
  if (all.length === 0) return;

  // Group by "name|type" key
  const groups = new Map<string, typeof all>();
  for (const cat of all) {
    const key = `${cat.name.toLowerCase()}|${cat.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cat);
  }

  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    // Keep the one with the latest updatedAt (most authoritative)
    group.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const [survivor, ...duplicates] = group;
    const duplicateIds = duplicates.map(d => d.id);

    // Re-point transactions that reference a duplicate to the survivor
    const affected = await db.transactions
      .filter(t => !!t.categoryId && duplicateIds.includes(t.categoryId))
      .toArray();

    for (const txn of affected) {
      await db.transactions.update(txn.id, { categoryId: survivor.id });
    }

    // Delete the duplicates
    await db.categories.bulkDelete(duplicateIds);
  }
}

/**
 * Purges any leftover starter/mock data from previous versions:
 * - Starter budgets ('University Week')
 * - Starter sample transactions ('Lunch')
 * - Starter accounts ('Wallet' / 'Card') if they have no user transactions
 */
export async function purgeMockData(): Promise<void> {
  try {
    // 1. Remove mock budget
    const mockBudgets = await db.budgets.filter(b => b.name === 'University Week').toArray();
    if (mockBudgets.length > 0) {
      await db.budgets.bulkDelete(mockBudgets.map(b => b.id));
    }

    // 2. Remove sample transaction
    const mockTxns = await db.transactions.filter(t => t.notes === 'Lunch' && t.amount === 500).toArray();
    if (mockTxns.length > 0) {
      await db.transactions.bulkDelete(mockTxns.map(t => t.id));
    }

    // 3. Remove legacy mock accounts if unused
    const legacyAccs = await db.accounts
      .filter(a => a.id === 'acc-cash' || a.id === 'acc-bank' || (a.name === 'Wallet' && a.balance === 5000) || (a.name === 'Card' && a.balance === 15000))
      .toArray();

    for (const acc of legacyAccs) {
      const txnCount = await db.transactions.filter(t => t.accountId === acc.id).count();
      if (txnCount === 0) {
        await db.accounts.delete(acc.id);
      }
    }
  } catch (err) {
    console.warn('[initDb] Error purging mock data:', err);
  }
}


