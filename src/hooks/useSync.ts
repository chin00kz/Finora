import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { syncAll, drainPendingSync, hydrateFromCloud } from '../sync/syncEngine';

export type SyncStatus = 'idle' | 'syncing' | 'error';

/**
 * useSync — drives automatic and manual synchronization.
 */
export function useSync(): {
  syncStatus: SyncStatus;
  manualSync: () => Promise<boolean>;
} {
  const { user } = useAuthStore();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const performSync = useCallback(async (userId: string) => {
    setSyncStatus('syncing');
    try {
      // First try to hydrate any remote data (e.g. from other devices)
      await hydrateFromCloud(userId);
      // Then sync all tables two-way
      const res = await syncAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
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

    // Run initial sync on login / mount
    void performSync(userId);

    // Periodic sync every 30 seconds
    intervalRef.current = setInterval(() => {
      void syncAll(userId);
    }, 30_000);

    const onOnline = async () => {
      setSyncStatus('syncing');
      await drainPendingSync(userId);
      const res = await syncAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
    };

    window.addEventListener('online', onOnline);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('online', onOnline);
    };
  }, [user?.id, performSync]);

  return { syncStatus, manualSync };
}
