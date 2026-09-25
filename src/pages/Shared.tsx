import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

import { Clock, ChevronRight, User } from 'lucide-react';
import { formatMoney } from '../utils/formatters';
import { useAuthStore } from '../store/authStore';
import { syncSharedIous, syncSharedIouSettlements, syncSharedPayments } from '../sync/sharedIouSync';
import { useParticipantIdentities } from '../hooks/useParticipantIdentities';

export default function Shared() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const debts = useLiveQuery(() => db.debts.toArray()) || [];
  const sharedIous = useLiveQuery(() => db.cacheSharedIous.toArray()) || [];
  
  
  const { identities } = useParticipantIdentities();

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      setIsRefreshing(true);
      await Promise.all([
        syncSharedIous(),
        syncSharedIouSettlements(),
        syncSharedPayments()
      ]);
      setIsRefreshing(false);
    };
    fetchAll();
  }, [user]);

  // Aggregate by identity
  const relationshipMap = useMemo(() => {
    const map = new Map<string, {
      identityKey: string;
      name: string;
      owedToYou: number;
      youOwe: number;
      pendingOwedToYou: number;
      pendingYouOwe: number;
      lastActivityAt: number;
    }>();

    const getOrAdd = (key: string) => {
      if (!map.has(key)) {
        const identity = identities.find(i => i.identityKey === key);
        map.set(key, {
          identityKey: key,
          name: identity?.name || 'Unknown',
          owedToYou: 0,
          youOwe: 0,
          pendingOwedToYou: 0,
          pendingYouOwe: 0,
          lastActivityAt: 0
        });
      }
      return map.get(key)!;
    };

    if (!user) return Array.from(map.values());

    // Local Debts
    debts.forEach(d => {
      const settledAmount = d.settlements?.reduce((s, st) => s + st.amount, 0) || 0; if (settledAmount >= d.amount) return;
      const r = getOrAdd(`local:${d.personId}`);
      if (d.direction === 'theyOweMe') r.owedToYou += d.amount;
      else r.youOwe += d.amount;
      r.lastActivityAt = Math.max(r.lastActivityAt, d.updatedAt || d.date || 0);
    });

    // Cloud Shared IOUs
    sharedIous.forEach(iou => {
      // we only care if we are creditor or debtor
      if (iou.creditor_id === user.id) {
        const r = getOrAdd(`profile:${iou.debtor_id}`);
        if (iou.status === 'accepted') r.owedToYou += iou.amount;
        else if (iou.status === 'pending') r.pendingOwedToYou += iou.amount;
        r.lastActivityAt = Math.max(r.lastActivityAt, iou.updated_at);
      } else if (iou.debtor_id === user.id) {
        const r = getOrAdd(`profile:${iou.creditor_id}`);
        if (iou.status === 'accepted') r.youOwe += iou.amount;
        else if (iou.status === 'pending') r.pendingYouOwe += iou.amount;
        r.lastActivityAt = Math.max(r.lastActivityAt, iou.updated_at);
      }
    });

    // We don't apply payments directly to totals here since backend RPC allocates them
    // and changes IOU status. But if there are pending payments, we could show them.
    // For now, keep it simple.

    return Array.from(map.values()).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }, [debts, sharedIous, identities, user]);

  return (
    <div className="max-w-md mx-auto p-4 pb-24">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Relationships</h1>
        <div className="flex gap-2">
          {isRefreshing && <span className="text-xs text-muted-foreground self-center">Refreshing...</span>}
        </div>
      </div>

      <div className="space-y-3">
        {relationshipMap.length === 0 ? (
          <div className="text-center py-10 bg-card rounded-2xl border border-border shadow-sm">
            <UsersIcon className="mx-auto text-muted-foreground mb-3 opacity-50" size={32} />
            <p className="text-muted-foreground text-sm">No shared financial activity yet.</p>
          </div>
        ) : (
          relationshipMap.map(r => (
            <button
              key={r.identityKey}
              onClick={() => navigate(`/shared/${encodeURIComponent(r.identityKey)}`)}
              className="w-full bg-card p-4 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow text-left flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
                  {r.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{r.name}</h3>
                  <div className="flex flex-col gap-0.5 mt-1">
                    {r.owedToYou > 0 && <span className="text-xs text-green-500 font-medium">Owes you LKR {formatMoney(r.owedToYou)}</span>}
                    {r.youOwe > 0 && <span className="text-xs text-red-500 font-medium">You owe LKR {formatMoney(r.youOwe)}</span>}
                    {r.pendingOwedToYou > 0 && <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock size={10}/> Pending requested: LKR {formatMoney(r.pendingOwedToYou)}</span>}
                  </div>
                  {r.owedToYou === 0 && r.youOwe === 0 && r.pendingOwedToYou === 0 && r.pendingYouOwe === 0 && (
                    <span className="text-xs text-muted-foreground">Settled</span>
                  )}
                </div>
              </div>
              <ChevronRight size={20} className="text-muted-foreground/50" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function UsersIcon(props: any) {
  return <User {...props} />;
}


