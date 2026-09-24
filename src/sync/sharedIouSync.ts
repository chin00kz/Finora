import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import type { CacheSharedIou } from '../db/db';

/**
 * Fetches all Shared IOUs visible to the authenticated user via RLS,
 * normalizes them, and atomically replaces the local Dexie read cache.
 * 
 * Preserves the existing cache if the fetch fails (e.g., offline).
 * This completely bypasses the generic dirty-sync pipeline.
 */
export async function syncSharedIous(): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Fetch from authoritative cloud via authenticated client
    // RLS policies automatically filter to rows where the user is creator, creditor, or debtor.
    const { data, error } = await supabase.from('shared_ious').select('*');
    
    if (error) {
      console.error('[SharedIOU Sync] Fetch failed:', error.message);
      return { success: false, error: error.message };
    }

    // 2. Normalize the cloud rows safely to the local Dexie schema
    const rows = data ?? [];
    const normalized: CacheSharedIou[] = rows.map((row: any) => ({
      id: row.id,
      creator_id: row.creator_id,
      creditor_id: row.creditor_id,
      debtor_id: row.debtor_id,
      amount: Number(row.amount),
      currency: row.currency,
      description: row.description || undefined,
      status: row.status,
      created_at: Number(row.created_at),
      accepted_at: row.accepted_at ? Number(row.accepted_at) : undefined,
      updated_at: Number(row.updated_at)
    }));

    // 3. Atomically replace the cache after successful fetch
    await db.transaction('rw', db.cacheSharedIous, async () => {
      await db.cacheSharedIous.clear();
      if (normalized.length > 0) {
        await db.cacheSharedIous.bulkPut(normalized);
      }
    });

    console.log(`[SharedIOU Sync] Atomically cached ${normalized.length} IOUs.`);
    return { success: true };
  } catch (err: any) {
    console.error('[SharedIOU Sync] Transaction/Normalization failed:', err.message);
    return { success: false, error: err.message };
  }
}
