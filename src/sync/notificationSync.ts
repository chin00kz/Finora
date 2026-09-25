import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import type { CacheNotification } from '../db/db';

export async function syncNotifications() {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.user) return;

  try {
    const { data, error } = await supabase.rpc('get_my_notifications', { p_limit: 100 });
    if (error) throw error;

    if (data) {
      const cachedNotes: CacheNotification[] = data.map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        actor_id: row.actor_id,
        type: row.type,
        title: row.title,
        body: row.body,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        route: row.route,
        event_key: row.event_key,
        read_at: row.read_at ? new Date(row.read_at).getTime() : undefined,
        created_at: new Date(row.created_at).getTime()
      }));

      await db.transaction('rw', [db.cacheNotifications], async () => {
        await db.cacheNotifications.clear();
        if (cachedNotes.length > 0) {
          await db.cacheNotifications.bulkPut(cachedNotes);
        }
      });
    }
  } catch (e: any) {
    console.warn("Failed to fetch notifications", e);
  }
}

export async function markNotificationRead(id: string) {
  try {
    // Cloud mutate first (authoritative)
    const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: id });
    if (error) throw error;
    
    // Update local cache only on success
    await db.cacheNotifications.update(id, { read_at: Date.now() });
  } catch (e) {
    console.warn("Failed to mark notification read", e);
  }
}

export async function markAllNotificationsRead() {
  try {
    // Cloud mutate first (authoritative)
    const { error } = await supabase.rpc('mark_all_notifications_read');
    if (error) throw error;

    // Update local cache only on success
    const unread = await db.cacheNotifications.filter(n => !n.read_at).toArray();
    const now = Date.now();
    for (const n of unread) {
      await db.cacheNotifications.update(n.id, { read_at: now });
    }
  } catch (e) {
    console.warn("Failed to mark all notifications read", e);
  }
}
