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

/**
 * Fetches all Shared IOU Settlements visible to the authenticated user via RLS,
 * normalizes them, and atomically replaces the local Dexie read cache.
 *
 * Preserves the existing cache if the fetch fails (e.g., offline).
 * This completely bypasses the generic dirty-sync pipeline.
 */
export async function syncSharedIouSettlements(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.from('shared_iou_settlements').select('*');

    if (error) {
      console.error('[SharedIOU Settlement Sync] Fetch failed:', error.message);
      return { success: false, error: error.message };
    }

    const rows = data ?? [];
    const normalized = rows.map((row: any) => ({
      id: row.id,
      shared_iou_id: row.shared_iou_id,
      amount: Number(row.amount),
      proposed_by: row.proposed_by,
      status: row.status,
      created_at: Number(row.created_at),
      confirmed_at: row.confirmed_at ? Number(row.confirmed_at) : undefined,
      confirmed_by: row.confirmed_by || undefined
    }));

    await db.transaction('rw', db.cacheSharedIouSettlements, async () => {
      await db.cacheSharedIouSettlements.clear();
      if (normalized.length > 0) {
        await db.cacheSharedIouSettlements.bulkPut(normalized);
      }
    });

    console.log(`[SharedIOU Settlement Sync] Atomically cached ${normalized.length} settlements.`);
    return { success: true };
  } catch (err: any) {
    console.error('[SharedIOU Settlement Sync] Transaction/Normalization failed:', err.message);
    return { success: false, error: err.message };
  }
}


export async function syncSharedPayments(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.from('shared_payments').select('*');
    if (error) return { success: false, error: error.message };
    
    const rows = data ?? [];
    const normalized = rows.map((row) => ({
      id: row.id,
      idempotency_key: row.idempotency_key,
      payer_id: row.payer_id,
      payee_id: row.payee_id,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      notes: row.notes,
      created_at: new Date(row.created_at).getTime(),
      updated_at: new Date(row.updated_at).getTime()
    }));

    await db.transaction('rw', db.sharedPayments, async () => {
      await db.sharedPayments.clear();
      if (normalized.length > 0) {
        await db.sharedPayments.bulkAdd(normalized);
      }
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
