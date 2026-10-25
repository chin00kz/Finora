/**
 * Persist one-active-budget healing (Dexie + sync dirty marks).
 */
import { db } from '../db/db';
import { triggerSync } from '../sync/syncEngine';
import { activeBudgetIdsToHeal, patchForEndingBudget } from './budgetLifecycle';

/** End surplus active budgets; keep the newest by startDate. */
export async function healMultipleActiveBudgets(
  now: number = Date.now(),
): Promise<{ endedIds: string[] }> {
  const all = await db.budgets.toArray();
  const { endIds } = activeBudgetIdsToHeal(all);
  if (endIds.length === 0) return { endedIds: [] };

  await db.transaction('rw', db.budgets, async () => {
    for (const id of endIds) {
      const b = await db.budgets.get(id);
      if (!b || b.status !== 'active') continue;
      await db.budgets.update(id, patchForEndingBudget(b, now));
    }
  });

  endIds.forEach(id => triggerSync('budgets', id));
  return { endedIds: endIds };
}
