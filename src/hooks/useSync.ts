import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { pullAll, pullLiveActivity, pushDirtyRecords, drainPendingSync, applyRealtimeChange, hasPendingDirty, ALL_TABLES } from '../sync/syncEngine';
import type { TableName } from '../sync/syncEngine';
import { syncNotifications } from '../sync/notificationSync';
import { syncConnections } from '../sync/connectionSync';
import { syncSharedIous, syncSharedIouSettlements, syncSharedPayments } from '../sync/sharedIouSync';
import { processSharedOutbox } from '../sync/sharedOutboxEngine';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
export type SyncStatus = 'idle' | 'syncing' | 'error';

// Minimum time between full background pulls (ms)
const MIN_FULL_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Interval to pull accounts + transactions while tab is visible (ms)
const LIVE_PULL_INTERVAL = 15 * 1000; // 15 seconds

/**
 * useSync — drives automatic and manual synchronisation.
 *
 * Invariant: PUSH BEFORE PULL
 * To prevent local mutations from ever being falsely deleted by incoming
 * cloud snapshots, all dirty local records and pending offline deletions
 * are flushed to Supabase BEFORE running reconciliation pulls.
 */
export function useSync(): {
  syncStatus: SyncStatus;
  manualSync: () => Promise<boolean>;
} {
  const { user } = useAuthStore();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const lastFullSyncRef = useRef<number>(0);

  // Push pending writes then pull cloud data into local
  const performSync = useCallback(async (userId: string) => {
    setSyncStatus('syncing');
    try {
      // 1. Drain pending local writes & deletes FIRST
      await drainPendingSync(userId);
      // 2. Flush shared-expense outbox and refresh social caches
      void processSharedOutbox();
      void syncNotifications();
      void syncConnections(userId);
      void syncSharedIous();
      void syncSharedIouSettlements();
      void syncSharedPayments();
      // 3. Pull and reconcile from cloud
      const res = await pullAll(userId);
      setSyncStatus(res.success ? 'idle' : 'error');
      lastFullSyncRef.current = Date.now();
      return res.success;
    } catch (err) {
      console.warn('[useSync] Sync error:', err);
      setSyncStatus('error');
      return false;
    }
  }, []);

  // Manual sync: flush any unsent local writes, then pull.
  const manualSync = useCallback(async () => {
    if (!user) return false;
    return performSync(user.id);
  }, [user, performSync]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) {
      setSyncStatus('idle');
      return;
    }

    const userId = user.id;

    // 1. Drain pending offline/boot writes first, then pull on mount/login
    void performSync(userId);

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
          const table = payload.table;
          if (ALL_TABLES.includes(table as any)) {
            const rowUser =
              (payload.new as Record<string, unknown> | undefined)?.user_id ||
              (payload.old as Record<string, unknown> | undefined)?.user_id;
            if (rowUser && rowUser !== userId) return;

            void applyRealtimeChange(
              table as TableName,
              payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
              (payload.new as Record<string, unknown>) || null,
              (payload.old as Record<string, unknown>) || null,
            );
          } else if (table === 'notifications') {
            const rowUser =
              (payload.new as Record<string, unknown> | undefined)?.user_id ||
              (payload.old as Record<string, unknown> | undefined)?.user_id;
            if (rowUser && rowUser !== userId) return;
            void syncNotifications();
          }
        },
      )
      .subscribe();

    const pullActivity = async () => {
      // If there are pending dirty writes for accounts or transactions, flush them first
      if (hasPendingDirty(['accounts', 'transactions'])) {
        await pushDirtyRecords(userId);
      }
      await pullLiveActivity(userId);
    };

    // 3. Pull when user returns to the tab (visibility change)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceLast = Date.now() - lastFullSyncRef.current;
        if (timeSinceLast > MIN_FULL_SYNC_INTERVAL) {
          void performSync(userId);
        } else {
          void pullActivity();
        }
      }
    };

    // 4. Pull when window regains focus (e.g. alt-tab back)
    const onFocus = () => {
      void pullActivity();
    };

    // 5. On reconnect: flush failed local writes & deletes, then pull
    const onOnline = () => {
      void performSync(userId);
    };

    // 6. Fast background polling for accounts + transactions while active (heartbeat fallback)
    const livePull = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pullActivity();
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
  }, [user?.id, performSync]);

  return { syncStatus, manualSync };
}
