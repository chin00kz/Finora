import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { pullAll, pullLiveActivity, pushDirtyRecords, drainPendingSync } from '../sync/syncEngine';
import { isSupabaseConfigured } from '../lib/supabase';
export type SyncStatus = 'idle' | 'syncing' | 'error';

// Minimum time between full 18-table background pulls (ms)
const MIN_FULL_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Interval to pull accounts + transactions while tab is visible (ms)
const LIVE_PULL_INTERVAL = 15 * 1000; // 15 seconds

/**
 * useSync — drives automatic and manual synchronisation.
 *
 * Sync model:
 *  1. LOGIN / MOUNT    → pullAll() only (load cloud data into local)
 *  2. LOCAL WRITE      → triggerSync(table, id) → debounced pushDirtyRecords()
 *  3. FOCUS / VISIBLE  → pullLiveActivity() immediately; pullAll() if >5 min
 *  4. LIVE INTERVAL    → pullLiveActivity() every 15s while tab is visible
 *  5. RECONNECT        → drainPendingSync() (flush failed writes) then pullAll()
 *  6. MANUAL SYNC      → pushDirtyRecords() then pullAll()
 */
export function useSync(): {
  syncStatus: SyncStatus;
  manualSync: () => Promise<boolean>;
} {
  const { user } = useAuthStore();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const lastFullSyncRef = useRef<number>(0);

  // Pull cloud data into local — used on login, focus, and visibility change.
  const performPull = useCallback(async (userId: string) => {
    setSyncStatus('syncing');
    try {
      const res = await pullAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastFullSyncRef.current = Date.now();
      return res.success;
    } catch (err) {
      console.warn('[useSync] Pull error:', err);
      setSyncStatus('error');
      return false;
    }
  }, []);

  // Manual sync: flush any unsent local writes, then pull.
  const manualSync = useCallback(async () => {
    if (!user) return false;
    setSyncStatus('syncing');
    try {
      await pushDirtyRecords(user.id);
      const res = await pullAll(user.id);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastFullSyncRef.current = Date.now();
      return res.success;
    } catch (err) {
      console.warn('[useSync] Manual sync error:', err);
      setSyncStatus('error');
      return false;
    }
  }, [user]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) {
      setSyncStatus('idle');
      return;
    }

    const userId = user.id;

    // 1. Pull on mount/login
    void performPull(userId);

    const pullActivity = () => {
      void pullLiveActivity(userId);
    };

    // 2. Pull when user returns to the tab (visibility change)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pullActivity();
        const timeSinceLast = Date.now() - lastFullSyncRef.current;
        if (timeSinceLast > MIN_FULL_SYNC_INTERVAL) {
          void performPull(userId);
        }
      }
    };

    // 3. Pull when window regains focus (e.g. alt-tab back)
    const onFocus = () => {
      pullActivity();
    };

    // 4. On reconnect: flush failed local writes, then pull
    const onOnline = async () => {
      setSyncStatus('syncing');
      await drainPendingSync(userId);
      const res = await pullAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastFullSyncRef.current = Date.now();
    };

    // 5. Fast background polling for accounts + transactions while active
    const livePull = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        pullActivity();
      }
    }, LIVE_PULL_INTERVAL);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      window.clearInterval(livePull);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [user?.id, performPull]);

  return { syncStatus, manualSync };
}
