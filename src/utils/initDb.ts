import { db } from '../db/db';
import { addDays, startOfDay } from 'date-fns';
import { supabase } from '../lib/supabase';

export async function initDbWithMockData() {
  // Never seed mock data if the user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return;

  const accountsCount = await db.accounts.count();
  if (accountsCount > 0) return; // Already initialized

  await db.accounts.bulkAdd([
    { id: 'acc-cash', name: 'Wallet', type: 'wallet', balance: 5000, currency: 'LKR', includeInTotal: true },
    { id: 'acc-bank', name: 'Card', type: 'card', balance: 15000, currency: 'LKR', includeInTotal: true }
  ]);

  await db.categories.bulkAdd([
    { id: 'cat-food', name: 'Food', type: 'expense', icon: 'utensils', color: '#f43f5e' },
    { id: 'cat-transport', name: 'Transport', type: 'expense', icon: 'bus', color: '#3b82f6' },
    { id: 'cat-salary', name: 'Salary', type: 'income', icon: 'briefcase', color: '#10b981' }
  ]);

  const today = startOfDay(new Date()).getTime();

  await db.budgets.add({
    id: 'bud-1',
    name: 'University Week',
    amount: 5000,
    period: 'days',
    periodLength: 4,
    startDate: today,
    endDate: addDays(today, 3).getTime(),
    status: 'active'
  });

  // Add a sample transaction
  await db.transactions.add({
    id: 'txn-1',
    type: 'expense',
    amount: 500,
    date: today,
    accountId: 'acc-cash',
    categoryId: 'cat-food',
    notes: 'Lunch'
  });

  // Update account balance
  const cashAcc = await db.accounts.get('acc-cash');
  if (cashAcc) {
    await db.accounts.update('acc-cash', { balance: cashAcc.balance - 500 });
  }
}

