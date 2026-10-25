/**
 * Network fetch for personal dataset meta (imports Supabase — not for pure Node tests).
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { PersonalDatasetMeta } from './datasetEpoch';

function isMissingRpcOrRelation(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  return (
    msg.includes('could not find the function') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    error.code === 'PGRST202' ||
    error.code === '42P01' ||
    error.code === '42883'
  );
}

/** Fetch server meta; soft-fail to epoch 0 when migrations are not deployed. */
export async function fetchPersonalDatasetMeta(): Promise<PersonalDatasetMeta> {
  if (!isSupabaseConfigured) {
    return { epoch: 0, lastReplacedAt: null, lastCloudFingerprint: null, unavailable: true };
  }
  try {
    const { data, error } = await supabase.rpc('get_personal_dataset_meta');
    if (error) {
      if (isMissingRpcOrRelation(error)) {
        return { epoch: 0, lastReplacedAt: null, lastCloudFingerprint: null, unavailable: true };
      }
      console.warn('[datasetEpoch] get_personal_dataset_meta failed:', error.message);
      return { epoch: 0, lastReplacedAt: null, lastCloudFingerprint: null, unavailable: true };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') {
      return { epoch: 0, lastReplacedAt: null, lastCloudFingerprint: null, unavailable: false };
    }
    const r = row as Record<string, unknown>;
    return {
      epoch: Number(r.epoch) || 0,
      lastReplacedAt: r.last_replaced_at != null ? String(r.last_replaced_at) : null,
      lastCloudFingerprint:
        r.last_cloud_fingerprint != null ? String(r.last_cloud_fingerprint) : null,
      unavailable: false,
    };
  } catch (err) {
    console.warn('[datasetEpoch] fetchPersonalDatasetMeta exception:', err);
    return { epoch: 0, lastReplacedAt: null, lastCloudFingerprint: null, unavailable: true };
  }
}
