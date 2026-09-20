import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { pullAll, pullLiveActivity, pushDirtyRecords, drainPendingSync, applyRealtimeChange, ALL_TABLES } from '../sync/syncEngine';
import type { TableName } from '../sync/syncEngine';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
export type SyncStatus = 'idle' | 'syncing' | 'error';

// Minimum time between full 18-table background pulls (ms)
const MIN_FULL_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Interval to pull accounts + transactions while tab is visible (ms)
const LIVE_PULL_INTERVAL = 15 * 1000; // 15 seconds

/**
 * useSync — drives automatic and manual synchronisation.
 *
 * Sync model:
 *  1. LOGIN / MOUNT    → pullAll() (load cloud data into local) + Realtime subscribe
 *  2. LOCAL WRITE      → triggerSync(table, id) → debounced pushDirtyRecords()
 *  3. REALTIME EVENT   → applyRealtimeChange() immediately (<300ms cross-device)
 *  4. FOCUS / VISIBLE  → pullLiveActivity() immediately; pullAll() if >5 min
 *  5. LIVE INTERVAL    → pullLiveActivity() every 15s while tab is visible
 *  6. RECONNECT        → drainPendingSync() (flush failed writes & deletes) then pullAll()
 *  7. MANUAL SYNC      → pushDirtyRecords() then pullAll()
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

    // 2. Realtime WebSocket subscription for instant cross-device updates
    const channel = supabase
      .channel(`realtime-finora-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
        },
        payload => {
          const table = payload.table as TableName;
          if (ALL_TABLES.includes(table)) {
            const rowUser =
              (payload.new as Record<string, unknown> | undefined)?.user_id ||
              (payload.old as Record<string, unknown> | undefined)?.user_id;
            if (rowUser && rowUser !== userId) return;

            void applyRealtimeChange(
              table,
              payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
              (payload.new as Record<string, unknown>) || null,
              (payload.old as Record<string, unknown>) || null,
            );
          }
        },
      )
      .subscribe();

    const pullActivity = () => {
      void pullLiveActivity(userId);
    };

    // 3. Pull when user returns to the tab (visibility change)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pullActivity();
        const timeSinceLast = Date.now() - lastFullSyncRef.current;
        if (timeSinceLast > MIN_FULL_SYNC_INTERVAL) {
          void performPull(userId);
        }
      }
    };

    // 4. Pull when window regains focus (e.g. alt-tab back)
    const onFocus = () => {
      pullActivity();
    };

    // 5. On reconnect: flush failed local writes & deletes, then pull
    const onOnline = async () => {
      setSyncStatus('syncing');
      await drainPendingSync(userId);
      const res = await pullAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastFullSyncRef.current = Date.now();
    };

    // 6. Fast background polling for accounts + transactions while active (heartbeat fallback)
    const livePull = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        pullActivity();
      }
    }, LIVE_PULL_INTERVAL);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(livePull);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [user?.id, performPull]);

  return { syncStatus, manualSync };
}
