import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { syncAll, drainPendingSync } from '../sync/syncEngine';
export type SyncStatus = 'idle' | 'syncing' | 'error';

// Minimum time between background syncs triggered by focus/visibility (ms)
const MIN_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * useSync — drives automatic and manual synchronization.
 *
 * Sync fires:
 *  1. On first login / app mount
 *  2. On every write (via triggerSync debounce in syncEngine)
 *  3. When the app comes back into focus / tab becomes visible (max once per 5 min)
 *  4. When the device comes back online
 *
 * No polling interval — much friendlier on battery and data.
 */
export function useSync(): {
  syncStatus: SyncStatus;
  manualSync: () => Promise<boolean>;
} {
  const { user } = useAuthStore();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const lastSyncRef = useRef<number>(0);

  const performSync = useCallback(async (userId: string) => {
    setSyncStatus('syncing');
    try {
      // syncAll does a full push + pull cycle; no need to also hydrateFromCloud
      // (that causes double-inserts on every refresh).
      const res = await syncAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastSyncRef.current = Date.now();
      return res.success;
    } catch (err) {
      console.warn('[useSync] Sync error:', err);
      setSyncStatus('error');
      return false;
    }
  }, []);

  const manualSync = useCallback(async () => {
    if (!user) return false;
    return await performSync(user.id);
  }, [user, performSync]);

  useEffect(() => {
    if (!user) {
      setSyncStatus('idle');
      return;
    }

    const userId = user.id;

    // 1. Sync on mount/login
    void performSync(userId);

    // 2. Sync when user returns to the tab (visibility change)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceLast = Date.now() - lastSyncRef.current;
        if (timeSinceLast > MIN_SYNC_INTERVAL) {
          void syncAll(userId).then(res => {
            setSyncStatus(res.success ? 'idle' : 'error');
            lastSyncRef.current = Date.now();
          });
        }
      }
    };

    // 3. Sync when window regains focus (e.g. alt-tab back)
    const onFocus = () => {
      const timeSinceLast = Date.now() - lastSyncRef.current;
      if (timeSinceLast > MIN_SYNC_INTERVAL) {
        void syncAll(userId).then(res => {
          setSyncStatus(res.success ? 'idle' : 'error');
          lastSyncRef.current = Date.now();
        });
      }
    };

    // 4. Sync when network comes back online
    const onOnline = async () => {
      setSyncStatus('syncing');
      await drainPendingSync(userId);
      const res = await syncAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastSyncRef.current = Date.now();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [user?.id, performSync]);

  return { syncStatus, manualSync };
}
