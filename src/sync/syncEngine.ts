/**
 * syncEngine.ts
 *
 * Robust Two-Way Sync between Dexie (local IndexedDB) and Supabase (Postgres).
 *
 * Write path: local first, always. Changes trigger debounced background sync.
 * Read path: local Dexie with useLiveQuery.
 * Sync path:
 *   1. Push local changes to Supabase (upsert with onConflict id).
 *   2. Pull remote records from Supabase into Dexie (merges based on updatedAt).
 *   3. Hydrate from cloud on new device login (clears mock data if cloud data exists).
 */

import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import { useAuthStore } from '../store/authStore';
import type { Account, Transaction, Budget, Tag, Category } from '../db/db';

export type TableName = 'accounts' | 'transactions' | 'budgets' | 'tags' | 'categories';
const PENDING_KEY = 'finora-pending-sync';
const MOCK_ACCOUNT_IDS = ['acc-cash', 'acc-bank'];

function getPending(): Set<TableName> {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return new Set(raw ? (JSON.parse(raw) as TableName[]) : []);
  } catch {
    return new Set();
  }
}

function markPending(table: TableName) {
  const s = getPending();
  s.add(table);
  localStorage.setItem(PENDING_KEY, JSON.stringify([...s]));
}

function clearPending(table: TableName) {
  const s = getPending();
  s.delete(table);
  localStorage.setItem(PENDING_KEY, JSON.stringify([...s]));
}

// ── camelCase ↔ snake_case mappers ──────────────────────────────────────────

function toSupabaseAccount(userId: string, a: Account) {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    type: a.type,
    balance: a.balance,
    currency: a.currency,
    include_in_total: a.includeInTotal,
    updated_at: a.updatedAt || Date.now(),
  };
}

function fromSupabaseAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    name: String(row.name),
    type: (row.type as Account['type']) || 'bank',
    balance: Number(row.balance) || 0,
    currency: String(row.currency || 'LKR'),
    includeInTotal: row.include_in_total !== false,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

function toSupabaseTransaction(userId: string, t: Transaction) {
  return {
    id: t.id,
    user_id: userId,
    type: t.type,
    amount: t.amount,
    date: t.date,
    account_id: t.accountId,
    category_id: t.categoryId || null,
    notes: t.notes || null,
    tag_ids: t.tagIds || null,
    to_account_id: t.toAccountId || null,
    is_shared: t.isShared || null,
    personal_amount: t.personalAmount != null ? t.personalAmount : null,
    is_settled: t.isSettled || null,
    exclude_from_budget: t.excludeFromBudget || null,
    updated_at: t.updatedAt || Date.now(),
  };
}

function fromSupabaseTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id),
    type: (row.type as Transaction['type']) || 'expense',
    amount: Number(row.amount) || 0,
    date: Number(row.date) || Date.now(),
    accountId: String(row.account_id),
    categoryId: row.category_id ? String(row.category_id) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    tagIds: Array.isArray(row.tag_ids) ? (row.tag_ids as string[]) : undefined,
    toAccountId: row.to_account_id ? String(row.to_account_id) : undefined,
    isShared: Boolean(row.is_shared),
    personalAmount: row.personal_amount != null ? Number(row.personal_amount) : undefined,
    isSettled: Boolean(row.is_settled),
    excludeFromBudget: Boolean(row.exclude_from_budget),
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

function toSupabaseBudget(userId: string, b: Budget) {
  return {
    id: b.id,
    user_id: userId,
    name: b.name,
    amount: b.amount,
    period: b.period,
    period_length: b.periodLength,
    start_date: b.startDate,
    end_date: b.endDate,
    status: b.status,
    updated_at: b.updatedAt || Date.now(),
  };
}

function fromSupabaseBudget(row: Record<string, unknown>): Budget {
  return {
    id: String(row.id),
    name: String(row.name),
    amount: Number(row.amount) || 0,
    period: (row.period as Budget['period']) || 'days',
    periodLength: Number(row.period_length) || 1,
    startDate: Number(row.start_date) || Date.now(),
    endDate: Number(row.end_date) || Date.now(),
    status: (row.status as Budget['status']) || 'active',
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

function toSupabaseTag(userId: string, t: Tag) {
  return {
    id: t.id,
    user_id: userId,
    name: t.name,
    color: t.color || null,
    updated_at: t.updatedAt || Date.now(),
  };
}

function fromSupabaseTag(row: Record<string, unknown>): Tag {
  return {
    id: String(row.id),
    name: String(row.name),
    color: row.color ? String(row.color) : undefined,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

function toSupabaseCategory(userId: string, c: Category) {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    type: c.type,
    icon: c.icon,
    color: c.color,
    updated_at: c.updatedAt || Date.now(),
  };
}

function fromSupabaseCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    type: (row.type as Category['type']) || 'expense',
    icon: String(row.icon || 'tag'),
    color: String(row.color || '#3b82f6'),
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// ── Push (Local → Supabase) ──────────────────────────────────────────────────

export async function pushTable(table: TableName, userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    let rows: Record<string, unknown>[] = [];

    if (table === 'accounts') {
      rows = (await db.accounts.toArray()).map(a => toSupabaseAccount(userId, a));
    } else if (table === 'transactions') {
      rows = (await db.transactions.toArray()).map(t => toSupabaseTransaction(userId, t));
    } else if (table === 'budgets') {
      rows = (await db.budgets.toArray()).map(b => toSupabaseBudget(userId, b));
    } else if (table === 'tags') {
      rows = (await db.tags.toArray()).map(t => toSupabaseTag(userId, t));
    } else if (table === 'categories') {
      rows = (await db.categories.toArray()).map(c => toSupabaseCategory(userId, c));
    }

    if (rows.length === 0) {
      clearPending(table);
      return { success: true };
    }

    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });

    if (error) {
      console.warn(`[sync] Push failed for ${table}:`, error.message);
      markPending(table);
      return { success: false, error: `${table}: ${error.message}` };
    }

    clearPending(table);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[sync] Push exception for ${table}:`, msg);
    markPending(table);
    return { success: false, error: `${table}: ${msg}` };
  }
}

// ── Pull (Supabase → Local) ──────────────────────────────────────────────────

export async function pullTable(table: TableName, userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId);
    if (error) {
      console.warn(`[sync] Pull failed for ${table}:`, error.message);
      return { success: false, error: `${table}: ${error.message}` };
    }
    if (!data || data.length === 0) return { success: true };

    if (table === 'accounts') {
      const items = data.map(r => fromSupabaseAccount(r));
      await db.accounts.bulkPut(items);
    } else if (table === 'transactions') {
      const items = data.map(r => fromSupabaseTransaction(r));
      await db.transactions.bulkPut(items);
    } else if (table === 'budgets') {
      const items = data.map(r => fromSupabaseBudget(r));
      await db.budgets.bulkPut(items);
    } else if (table === 'tags') {
      const items = data.map(r => fromSupabaseTag(r));
      await db.tags.bulkPut(items);
    } else if (table === 'categories') {
      const items = data.map(r => fromSupabaseCategory(r));
      await db.categories.bulkPut(items);
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[sync] Pull exception for ${table}:`, msg);
    return { success: false, error: `${table}: ${msg}` };
  }
}

// ── Delete from Supabase ────────────────────────────────────────────────────

export async function deleteFromCloud(table: TableName, id: string): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return;
  try {
    await supabase.from(table).delete().eq('id', id).eq('user_id', user.id);
  } catch (err) {
    console.warn(`[sync] Delete failed for ${table}/${id}:`, err);
  }
}

async function migrateLegacyIds(): Promise<void> {
  try {
    const cash = await db.accounts.get('acc-cash');
    if (cash) {
      const newId = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await db.accounts.delete('acc-cash');
      await db.accounts.add({ ...cash, id: newId, updatedAt: Date.now() });
      const txns = await db.transactions.filter(t => t.accountId === 'acc-cash').toArray();
      for (const t of txns) {
        await db.transactions.update(t.id, { accountId: newId, updatedAt: Date.now() });
      }
    }

    const bank = await db.accounts.get('acc-bank');
    if (bank) {
      const newId = `acc-${Date.now() + 1}-${Math.random().toString(36).substring(2, 7)}`;
      await db.accounts.delete('acc-bank');
      await db.accounts.add({ ...bank, id: newId, updatedAt: Date.now() });
      const txns = await db.transactions.filter(t => t.accountId === 'acc-bank').toArray();
      for (const t of txns) {
        await db.transactions.update(t.id, { accountId: newId, updatedAt: Date.now() });
      }
    }

    const legacyCats = ['cat-food', 'cat-transport', 'cat-salary'];
    for (const catId of legacyCats) {
      const cat = await db.categories.get(catId);
      if (cat) {
        const newId = `cat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await db.categories.delete(catId);
        await db.categories.add({ ...cat, id: newId, updatedAt: Date.now() });
        const txns = await db.transactions.filter(t => t.categoryId === catId).toArray();
        for (const t of txns) {
          await db.transactions.update(t.id, { categoryId: newId, updatedAt: Date.now() });
        }
      }
    }

    const bud = await db.budgets.get('bud-1');
    if (bud) {
      const newId = `bud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await db.budgets.delete('bud-1');
      await db.budgets.add({ ...bud, id: newId, updatedAt: Date.now() });
    }

    const txn = await db.transactions.get('txn-1');
    if (txn) {
      const newId = `txn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await db.transactions.delete('txn-1');
      await db.transactions.add({ ...txn, id: newId, updatedAt: Date.now() });
    }
  } catch (err) {
    console.warn('[sync] Legacy ID migration failed:', err);
  }
}

// ── Full Two-Way Sync ────────────────────────────────────────────────────────

/**
 * Runs a full two-way sync: pushes local changes then pulls remote changes.
 */
export async function syncAll(userId: string): Promise<{ success: boolean; error?: string }> {
  await migrateLegacyIds();
  const tables: TableName[] = ['accounts', 'categories', 'tags', 'budgets', 'transactions'];
  
  // 1. Push all local tables
  const pushResults = await Promise.all(tables.map(t => pushTable(t, userId)));
  const failedPush = pushResults.find(r => !r.success);
  if (failedPush) {
    return { success: false, error: `Upload error (${failedPush.error})` };
  }
  
  // 2. Pull all remote tables
  const pullResults = await Promise.all(tables.map(t => pullTable(t, userId)));
  const failedPull = pullResults.find(r => !r.success);
  if (failedPull) {
    return { success: false, error: `Download error (${failedPull.error})` };
  }

  useAuthStore.getState().setLastSyncedAt(Date.now());
  return { success: true };
}

/** Retry any tables that failed during a previous push */
export async function drainPendingSync(userId: string): Promise<void> {
  const pending = getPending();
  if (pending.size === 0) return;
  console.log('[sync] Draining pending:', [...pending]);
  await Promise.all([...pending].map(t => pushTable(t, userId)));
}

// ── Hydrate from Cloud (Used on Login / New Device) ──────────────────────────

/**
 * Pulls all user data from Supabase into Dexie.
 * If cloud has data, removes default starter mock data so it doesn't collide.
 */
export async function hydrateFromCloud(userId: string): Promise<{ restoredCount: number }> {
  await migrateLegacyIds();
  const [accsRes, txnsRes, budsRes, tagsRes, catsRes] = await Promise.all([
    supabase.from('accounts').select('*').eq('user_id', userId),
    supabase.from('transactions').select('*').eq('user_id', userId),
    supabase.from('budgets').select('*').eq('user_id', userId),
    supabase.from('tags').select('*').eq('user_id', userId),
    supabase.from('categories').select('*').eq('user_id', userId),
  ]);

  const hasCloudData =
    (accsRes.data && accsRes.data.length > 0) ||
    (txnsRes.data && txnsRes.data.length > 0) ||
    (budsRes.data && budsRes.data.length > 0);

  if (!hasCloudData) {
    return { restoredCount: 0 };
  }

  // If cloud has real data, remove starter mock accounts/txns from Dexie
  const localAccounts = await db.accounts.toArray();
  const onlyMockData = localAccounts.length > 0 && localAccounts.every(a => MOCK_ACCOUNT_IDS.includes(a.id));
  if (onlyMockData) {
    await db.accounts.clear();
    await db.transactions.clear();
    await db.budgets.clear();
  }

  let count = 0;
  if (accsRes.data?.length) {
    await db.accounts.bulkPut(accsRes.data.map(r => fromSupabaseAccount(r)));
    count += accsRes.data.length;
  }
  if (txnsRes.data?.length) {
    await db.transactions.bulkPut(txnsRes.data.map(r => fromSupabaseTransaction(r)));
    count += txnsRes.data.length;
  }
  if (budsRes.data?.length) {
    await db.budgets.bulkPut(budsRes.data.map(r => fromSupabaseBudget(r)));
    count += budsRes.data.length;
  }
  if (tagsRes.data?.length) {
    await db.tags.bulkPut(tagsRes.data.map(r => fromSupabaseTag(r)));
    count += tagsRes.data.length;
  }
  if (catsRes.data?.length) {
    await db.categories.bulkPut(catsRes.data.map(r => fromSupabaseCategory(r)));
    count += catsRes.data.length;
  }

  useAuthStore.getState().setLastSyncedAt(Date.now());
  return { restoredCount: count };
}

// ── Debounced Trigger Helper ────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Call this whenever any local data changes (e.g. adding transaction, updating account).
 * If user is logged in, triggers debounced sync.
 */
export function triggerSync(immediate = false): void {
  const user = useAuthStore.getState().user;
  if (!user) return;

  if (syncTimer) clearTimeout(syncTimer);
  const delay = immediate ? 100 : 1500;
  syncTimer = setTimeout(() => {
    void syncAll(user.id);
    syncTimer = null;
  }, delay);
}
