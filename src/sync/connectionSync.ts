import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import type { CacheConnection, CacheProfile } from '../db/db';

export async function syncConnections(userId: string) {
  try {
    const { data, error } = await supabase.rpc('get_my_connections');
    if (error) throw error;

    if (data) {
      const conns: CacheConnection[] = [];
      const profs: CacheProfile[] = [];

      data.forEach((row: any) => {
        if (row.status === 'declined') return;
        conns.push({
          id: row.connection_id,
          user_a: userId,
          user_b: row.other_user_id,
          status: row.status,
          action_user_id: row.action_user_id,
          created_at: 0,
          updatedAt: Date.now()
        });

        profs.push({
          id: row.other_user_id,
          username: row.other_username,
          display_name: row.other_display_name,
          updatedAt: Date.now()
        });
      });

      await db.transaction('rw', [db.cacheConnections, db.cacheProfiles], async () => {
        await db.cacheConnections.clear();
        if (conns.length > 0) await db.cacheConnections.bulkPut(conns);
        if (profs.length > 0) await db.cacheProfiles.bulkPut(profs);
      });
    }
    return { success: true };
  } catch (e: any) {
    console.warn("Failed to fetch connections", e);
    return { success: false, error: e.message };
  }
}
