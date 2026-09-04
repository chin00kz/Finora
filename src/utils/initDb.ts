import { db } from '../db/db';
import { addDays, startOfDay } from 'date-fns';
import { supabase } from '../lib/supabase';

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

export async function initDbWithMockData() {
  // Never seed mock data if the user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return;

  const accountsCount = await db.accounts.count();
  if (accountsCount > 0) return; // Already initialized

  const rand = () => Math.random().toString(36).substring(2, 7);
  const cashId = `acc-${Date.now()}-${rand()}`;
  const bankId = `acc-${Date.now() + 1}-${rand()}`;
  const foodId = `cat-${Date.now()}-${rand()}`;
  const transportId = `cat-${Date.now() + 1}-${rand()}`;
  const salaryId = `cat-${Date.now() + 2}-${rand()}`;

  await db.accounts.bulkAdd([
    { id: cashId, name: 'Wallet', type: 'wallet', balance: 5000, currency: 'LKR', includeInTotal: true, updatedAt: Date.now() },
    { id: bankId, name: 'Card', type: 'card', balance: 15000, currency: 'LKR', includeInTotal: true, updatedAt: Date.now() }
  ]);

  await db.categories.bulkAdd([
    { id: foodId, name: 'Food', type: 'expense', icon: 'utensils', color: '#f43f5e', updatedAt: Date.now() },
    { id: transportId, name: 'Transport', type: 'expense', icon: 'bus', color: '#3b82f6', updatedAt: Date.now() },
    { id: salaryId, name: 'Salary', type: 'income', icon: 'briefcase', color: '#10b981', updatedAt: Date.now() }
  ]);

  const today = startOfDay(new Date()).getTime();

  await db.budgets.add({
    id: `bud-${Date.now()}-${rand()}`,
    name: 'University Week',
    amount: 5000,
    period: 'days',
    periodLength: 4,
    startDate: today,
    endDate: addDays(today, 3).getTime(),
    status: 'active',
    updatedAt: Date.now()
  });

  // Add a sample transaction
  await db.transactions.add({
    id: `txn-${Date.now()}-${rand()}`,
    type: 'expense',
    amount: 500,
    date: today,
    accountId: cashId,
    categoryId: foodId,
    notes: 'Lunch',
    updatedAt: Date.now()
  });

  // Update account balance
  const cashAcc = await db.accounts.get(cashId);
  if (cashAcc) {
    await db.accounts.update(cashId, { balance: cashAcc.balance - 500 });
  }
}

