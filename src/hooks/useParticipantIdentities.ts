import { useLiveQuery } from 'dexie-react-hooks';
import { db, Person, CacheProfile, CacheConnection } from '../db/db';
import { useMemo } from 'react';

export interface UnifiedIdentity {
  identityKey: string; // 'profile:<uuid>' or 'local:<id>'
  name: string;
  isConnected: boolean;
}

export function useParticipantIdentities(currentUserId?: string) {
  const people = useLiveQuery(() => db.people.toArray()) || [];
  const profiles = useLiveQuery(() => db.cacheProfiles.toArray()) || [];
  const connections = useLiveQuery(() => db.cacheConnections.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.filter(t => !t.isDeleted).toArray()) || [];
  const groups = useLiveQuery(() => db.groups?.toArray() || []) || [];

  const identities = useMemo(() => {
    if (!currentUserId) return [];

    const result: UnifiedIdentity[] = [];
    const seenProfileIds = new Set<string>();

    // 1. Process accepted connections (Friends)
    const activeConnections = connections.filter(c => c.status === 'accepted');
    for (const conn of activeConnections) {
      const friendId = conn.user_a === currentUserId ? conn.user_b : conn.user_a;
      const profile = profiles.find(p => p.id === friendId);
      if (profile) {
        result.push({
          identityKey: `profile:${profile.id}`,
          name: profile.display_name || profile.username || 'Unknown Friend',
          isConnected: true,
        });
        seenProfileIds.add(profile.id);
      }
    }

    // 2. Process local people, deduplicating those mapped to seen profiles
    for (const person of people) {
      let isMappedToFriend = false;
      if (person.connection_id) {
        // If this local person has a connection_id, check if that connection is still active and in our seen list
        const conn = connections.find(c => c.id === person.connection_id);
        if (conn && conn.status === 'accepted') {
          const friendId = conn.user_a === currentUserId ? conn.user_b : conn.user_a;
          if (seenProfileIds.has(friendId)) {
            isMappedToFriend = true;
          }
        }
      }

      if (!isMappedToFriend) {
        result.push({
          identityKey: `local:${person.id}`,
          name: person.name,
          isConnected: false,
        });
      }
    }

    // Sort alphabetically
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [people, profiles, connections, currentUserId]);

  const recentCombinations = useMemo(() => {
    // Look at last 50 shared transactions
    const sharedTxns = [...transactions]
      .filter(t => t.splitDetails && t.splitDetails.length > 0)
      .sort((a, b) => b.date - a.date)
      .slice(0, 50);

    const comboCounts = new Map<string, { count: number, keys: string[], names: string[] }>();
    
    for (const txn of sharedTxns) {
      // Extract identities involved, excluding "Me" (if we want to assume "Me" is always implied for combinations)
      // Actually, just collect everyone except "local:me" if we had that. We don't. We just use identityKey.
      const keys = [...new Set(txn.splitDetails!.map(s => s.personId))].sort();
      // Only care about combinations of 1+ OTHER people. (If 'You' is included, we might need to filter it out if we model 'You' explicitly, but usually 'You' is just currentUserId).
      // Since currentUserId isn't stored explicitly in local splitDetails (the payer is just the owner of the DB), any identityKey in splitDetails is "an other person".
      const comboId = keys.join('|');
      if (!comboId || keys.length === 0) continue;

      if (!comboCounts.has(comboId)) {
        const names = keys.map(k => {
          const idMatch = identities.find(i => i.identityKey === k);
          if (idMatch) return idMatch.name;
          // Fallback to historical snapshot
          const snapshot = txn.splitDetails!.find(s => s.personId === k)?.participantNameSnapshot;
          return snapshot || 'Unknown';
        });
        comboCounts.set(comboId, { count: 0, keys, names });
      }
      comboCounts.get(comboId)!.count++;
    }

    return Array.from(comboCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5
  }, [transactions, identities]);

  return { identities, groups, recentCombinations };
}
