/**
 * Persist one-active-budget healing and natural expiry (Dexie + sync dirty marks).
 */
import { db } from '../db/db';
import { triggerSync } from '../sync/syncEngine';
import {
  activeBudgetIdsPastEnd,
  activeBudgetIdsToHeal,
  patchForEndingBudget,
  patchForNaturalBudgetExpiry,
} from './budgetLifecycle';

/**
 * End surplus active budgets; expire actives past endDate (keeping planned endDate).
 * Safe to call on Budget / Dashboard mount.
 */
export async function healMultipleActiveBudgets(
  now: number = Date.now(),
): Promise<{ endedIds: string[] }> {
  const all = await db.budgets.toArray();
  const { endIds: surplusIds } = activeBudgetIdsToHeal(all);
  const expiredIds = activeBudgetIdsPastEnd(all, now);
  const endedIds = [...new Set([...surplusIds, ...expiredIds])];
  if (endedIds.length === 0) return { endedIds: [] };

  await db.transaction('rw', db.budgets, async () => {
    for (const id of endedIds) {
      const b = await db.budgets.get(id);
      if (!b || b.status !== 'active') continue;
      if (surplusIds.includes(id)) {
        await db.budgets.update(id, patchForEndingBudget(b, now));
      } else {
        await db.budgets.update(id, patchForNaturalBudgetExpiry(now));
      }
    }
  });

  endedIds.forEach(id => triggerSync('budgets', id));
  return { endedIds };
}
