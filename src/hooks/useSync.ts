import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { syncAll, drainPendingSync, pullLiveActivity } from '../sync/syncEngine';
export type SyncStatus = 'idle' | 'syncing' | 'error';

const MIN_FULL_SYNC_INTERVAL = 5 * 60 * 1000;
const LIVE_PULL_INTERVAL = 15 * 1000;

/**
 * Full sync on login, writes, and going back online.
 * While the app is open, only accounts + activity are pulled every 15s / on focus
 * so the other device's new transactions show up without dumping the whole DB.
 */
export function useSync(): {
  syncStatus: SyncStatus;
  manualSync: () => Promise<boolean>;
} {
  const { user } = useAuthStore();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const lastFullSyncRef = useRef<number>(0);

  const performSync = useCallback(async (userId: string) => {
    setSyncStatus('syncing');
    try {
      const res = await syncAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastFullSyncRef.current = Date.now();
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

    void performSync(userId);

    const pullActivity = () => {
      void pullLiveActivity(userId);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      pullActivity();
      const timeSinceFull = Date.now() - lastFullSyncRef.current;
      if (timeSinceFull > MIN_FULL_SYNC_INTERVAL) {
        void performSync(userId);
      }
    };

    const onFocus = () => {
      pullActivity();
    };

    const onOnline = async () => {
      setSyncStatus('syncing');
      await drainPendingSync(userId);
      const res = await syncAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastFullSyncRef.current = Date.now();
    };

    const livePull = window.setInterval(() => {
      if (document.visibilityState === 'visible') pullActivity();
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
  }, [user?.id, performSync]);

  return { syncStatus, manualSync };
}
