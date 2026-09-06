import { db } from '../db/db';
import type { RecurringFrequency } from '../db/db';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { triggerSync } from '../sync/syncEngine';

/**
 * Advances a timestamp to the next cycle based on frequency.
 */
export function advanceDueDate(currentDate: number, frequency: RecurringFrequency): number {
  const d = new Date(currentDate);
  switch (frequency) {
    case 'daily':
      return addDays(d, 1).getTime();
    case 'weekly':
      return addWeeks(d, 1).getTime();
    case 'monthly':
      return addMonths(d, 1).getTime();
    case 'yearly':
      return addYears(d, 1).getTime();
    default:
      return addMonths(d, 1).getTime();
  }
}

/**
 * Checks all active recurring rules and auto-creates regular transactions
 * for any due occurrences up to the current moment.
 * Updates account balances and syncs.
 */
export async function processDueRecurringTransactions(): Promise<number> {
  const now = Date.now();
  const activeRules = await db.recurringTransactions.filter(r => r.active && r.nextDueDate <= now).toArray();

  if (activeRules.length === 0) return 0;

  let createdCount = 0;

  for (const rule of activeRules) {
    let nextDue = rule.nextDueDate;
    const maxIterations = 50; // Safety guard against infinite loops
    let iter = 0;

    while (nextDue <= now && iter < maxIterations) {
      iter++;
      const txnDate = nextDue;
      const rand = Math.random().toString(36).substring(2, 7);
      const txnId = `txn-rec-${txnDate}-${rand}`;

      await db.transaction('rw', [db.transactions, db.accounts, db.recurringTransactions], async () => {
        // 1. Create the regular transaction
        await db.transactions.add({
          id: txnId,
          type: rule.type,
          amount: rule.amount,
          date: txnDate,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          notes: `${rule.name} (Recurring)`,
          updatedAt: Date.now(),
        });

        // 2. Adjust account balance
        const acc = await db.accounts.get(rule.accountId);
        if (acc) {
          const delta = rule.type === 'expense' ? -rule.amount : rule.amount;
          await db.accounts.update(rule.accountId, {
            balance: acc.balance + delta,
            updatedAt: Date.now(),
          });
        }

        // 3. Advance rule nextDueDate
        nextDue = advanceDueDate(nextDue, rule.frequency);
        await db.recurringTransactions.update(rule.id, {
          nextDueDate: nextDue,
          updatedAt: Date.now(),
        });
      });

      createdCount++;
    }
  }

  if (createdCount > 0) {
    triggerSync();
  }

  return createdCount;
}
