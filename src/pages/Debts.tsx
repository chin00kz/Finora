import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Debt } from '../db/db';
import { Plus, Search } from 'lucide-react';
import AddDebtModal from '../components/AddDebtModal';
import SettleDebtModal from '../components/SettleDebtModal';
import ProposePaymentModal from '../components/ProposePaymentModal';
import { canProposePayment, canReviewPayment } from '../utils/sharedIouSettlementEngine';
import CreditorSettlementReview from '../components/CreditorSettlementReview';
import type { CacheSharedIouSettlement } from '../db/db';
import { getDebtSettlementStatus, reconcileSharedExpenses } from '../utils/debtSettlementEngine';
import { getSharedIouSettlementStatus } from '../utils/sharedIouSettlementEngine';
import MaskedAmount from '../components/MaskedAmount';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import { syncSharedIous } from '../sync/sharedIouSync';

type FilterTab = 'all' | 'owed_to_me' | 'i_owe' | 'settled';

interface UnifiedIou {
  id: string;
  source: 'local' | 'shared';
  personName: string;
  username?: string;
  amount: number;
  originalAmount: number;
  currency: string;
  direction: 'theyOweMe' | 'iOweThem';
  description?: string;
  status: 'active' | 'settled' | 'pending';
  date: number;
  isShared: boolean;
  rawDebt?: Debt;
  availableToPropose?: number;
  pendingTotal?: number;
  pendingSettlements?: CacheSharedIouSettlement[];
}

export default function Debts() {
  const debts = useLiveQuery(() => db.debts.toArray()) || [];
  const sharedIous = useLiveQuery(() => db.cacheSharedIous.toArray()) || [];
  const cacheSharedIouSettlements = useLiveQuery(() => db.cacheSharedIouSettlements.toArray()) || [];
  const cachedProfiles = useLiveQuery(() => db.cacheProfiles.toArray()) || [];
  const { user } = useAuthStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedDebtForSettlement, setSelectedDebtForSettlement] = useState<Debt | null>(null);
  const [proposePaymentIou, setProposePaymentIou] = useState<UnifiedIou | null>(null);

  const [actioning, setActioning] = useState<{id: string, action: 'accepted' | 'declined'} | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionedIous, setActionedIous] = useState<Record<string, string>>({});

  useEffect(() => {
    reconcileSharedExpenses();
  }, []);

  useEffect(() => {
    if (!user) return;
    const neededProfileIds = new Set<string>();
    sharedIous.forEach(iou => {
      const otherId = iou.creator_id === user.id ? iou.debtor_id : iou.creator_id;
      if (!cachedProfiles.find(p => p.id === otherId)) {
        neededProfileIds.add(otherId);
      }
    });
    if (neededProfileIds.size > 0) {
      const fetchProfiles = async () => {
        try {
          const { data, error } = await supabase.rpc('get_my_connections');
          if (error) throw error;
          if (data) {
            const profs = data.map((row: any) => ({
              id: row.other_user_id,
              username: row.other_username,
              display_name: row.other_display_name,
              updatedAt: Date.now()
            }));
            await db.cacheProfiles.bulkPut(profs);
          }
        } catch (err) {
          console.error("Failed to securely fetch profiles", err);
        }
      };
      fetchProfiles();
    }
  }, [sharedIous, cachedProfiles, user]);

  useEffect(() => {
    if (user) {
      syncSharedIous().catch(e => console.error("Initial shared IOU sync failed", e));
    }
  }, [user]);

  const handleActionSharedIou = async (iouId: string, action: 'accepted' | 'declined') => {
    if (!user || actioning) return;
    setActioning({ id: iouId, action });
    setActionError(null);

    const rpcName = action === 'accepted' ? 'accept_shared_iou' : 'decline_shared_iou';

    try {
      const { error } = await supabase.rpc(rpcName, { p_iou_id: iouId });
      if (error) throw error;
      setActionedIous(prev => ({ ...prev, [iouId]: action }));
      const res = await syncSharedIous();
      if (!res.success) {
        console.warn('Post-mutation cache refresh failed.', res.error);
      }
    } catch (err: any) {
      console.error(`Failed to ${action} shared IOU`, err);
      setActionError(err.message || `Failed to ${action} request. Please try again.`);
    } finally {
      setActioning(null);
    }
  };

  const incomingRequests = useMemo(() => {
    return sharedIous.filter(
      iou => iou.status === 'pending' && iou.debtor_id === user?.id && !actionedIous[iou.id]
    );
  }, [sharedIous, user, actionedIous]);

  const unifiedIous = useMemo(() => {
    const list: UnifiedIou[] = [];

    for (const d of debts) {
      const { remainingAmount, isFullySettled } = getDebtSettlementStatus(d);
      list.push({
        id: d.id,
        source: 'local',
        personName: d.personName || 'Unknown',
        amount: remainingAmount,
          originalAmount: d.amount,
          currency: 'LKR',
        direction: d.direction,
        description: d.note,
        status: isFullySettled ? 'settled' : 'active',
        date: d.date || 0,
        isShared: false,
        rawDebt: d
      });
    }

      for (const iou of sharedIous) {
        const isAccepted = iou.status === 'accepted' || actionedIous[iou.id] === 'accepted';
        const isSettled = iou.status === 'settled';
        const isOutgoingPending = iou.status === 'pending' && iou.creator_id === user?.id && !actionedIous[iou.id];

        if (isAccepted || isSettled || isOutgoingPending) {
          const otherId = iou.creditor_id === user?.id ? iou.debtor_id : iou.creditor_id;
          const otherProf = cachedProfiles.find(p => p.id === otherId);

          const iouSettlements = cacheSharedIouSettlements.filter(s => s.shared_iou_id === iou.id);
          const { remainingAmount, availableToPropose, pendingTotal } = getSharedIouSettlementStatus(iou.amount, iouSettlements);
          const pendingSettlements = iouSettlements.filter(s => s.status === 'pending');

          list.push({
            id: iou.id,
            source: 'shared',
            personName: otherProf?.display_name || 'Unknown',
            username: otherProf?.username,
            amount: remainingAmount,
            originalAmount: iou.amount,
            currency: iou.currency,
            direction: iou.creditor_id === user?.id ? 'theyOweMe' : 'iOweThem',
            description: iou.description,
            status: (isSettled || (isAccepted && remainingAmount === 0)) ? 'settled' : (isAccepted ? 'active' : 'pending'),
            date: iou.created_at || 0,
            isShared: true,
            availableToPropose,
            pendingTotal,
            pendingSettlements
          });
        }
      }

      return list;
    }, [debts, sharedIous, cacheSharedIouSettlements, actionedIous, user, cachedProfiles]);

  const debtMetrics = useMemo(() => {
    let totalOwedToMe = 0;
    let totalIOwe = 0;

    for (const iou of unifiedIous) {
      if (iou.status === 'active') {
        if (iou.direction === 'theyOweMe') {
          totalOwedToMe += iou.amount;
        } else {
          totalIOwe += iou.amount;
        }
      }
    }

    const netBalance = totalOwedToMe - totalIOwe;
    return { totalOwedToMe, totalIOwe, netBalance };
  }, [unifiedIous]);

  const filteredIous = useMemo(() => {
    return unifiedIous
      .filter(iou => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const match =
            iou.personName.toLowerCase().includes(q) ||
            (iou.username && iou.username.toLowerCase().includes(q)) ||
            (iou.description && iou.description.toLowerCase().includes(q)) ||
            String(iou.amount).includes(q);
          if (!match) return false;
        }

        if (activeTab === 'owed_to_me') {
          if (iou.direction !== 'theyOweMe' || iou.status === 'settled') return false;
        } else if (activeTab === 'i_owe') {
          if (iou.direction !== 'iOweThem' || iou.status === 'settled') return false;
        } else if (activeTab === 'settled') {
          if (iou.status !== 'settled') return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (a.status !== b.status) {
          if (a.status === 'pending') return -1;
          if (b.status === 'pending') return 1;
          if (a.status === 'settled') return 1;
          if (b.status === 'settled') return -1;
        }
        return b.date - a.date;
      });
  }, [unifiedIous, activeTab, searchQuery]);

  return (
    <div className="p-6 pb-28 max-w-3xl mx-auto space-y-8">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-xl font-medium text-foreground tracking-tight">IOUs & Debts</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage money owed between people
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-xl text-sm font-medium shadow-sm hover:opacity-90 active:scale-95 transition-all"
        >
          <Plus size={16} />
          <span>Record</span>
        </button>
      </div>

      {/* ONE Financial Summary Card */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">You're owed</p>
            <p className="text-3xl font-medium text-emerald-500 tracking-tight">
              <span className="text-base mr-1 font-normal text-muted-foreground">LKR</span>
              <MaskedAmount amount={debtMetrics.totalOwedToMe} />
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">You owe</p>
            <p className="text-3xl font-medium text-amber-500 tracking-tight">
              <span className="text-base mr-1 font-normal text-muted-foreground">LKR</span>
              <MaskedAmount amount={debtMetrics.totalIOwe} />
            </p>
          </div>
        </div>
        <div className="border-t border-border/40 pt-4 flex items-center justify-between">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Net Balance</p>
          <p className={`text-sm font-medium ${debtMetrics.netBalance >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
            {debtMetrics.netBalance >= 0 ? '+' : '-'}
            <MaskedAmount amount={Math.abs(debtMetrics.netBalance)} prefix="LKR " />
          </p>
        </div>
      </div>

      {/* Phase 2D: Shared IOU Requests (Compact Cards) */}
      {incomingRequests.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Requests</h4>
            <span className="text-[10px] font-medium bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full">{incomingRequests.length}</span>
          </div>
          {actionError && <p className="text-sm text-red-500 mb-2">{actionError}</p>}
          <div className="grid gap-3">
            {incomingRequests.map(iou => {
              const creator = cachedProfiles.find(p => p.id === iou.creator_id);
              const name = creator?.display_name || "Unknown";
              const username = creator?.username ? `@${creator.username}` : "";
              const isProcessing = actioning?.id === iou.id;

              return (
                <div key={iou.id} className={`bg-card rounded-2xl p-4 border border-border/60 shadow-sm flex flex-col gap-4 ${isProcessing ? 'opacity-60 pointer-events-none' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-medium text-foreground truncate">{name}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {username}{iou.description ? ` · ${iou.description}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-medium text-foreground tracking-tight">
                        {iou.currency} {iou.amount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleActionSharedIou(iou.id, 'declined')}
                      disabled={isProcessing}
                      className="px-4 py-2.5 bg-red-500/10 text-red-600 dark:text-red-400 text-xs rounded-xl font-medium active:scale-95 transition-all border border-red-500/20"
                    >
                      {isProcessing && actioning?.action === 'declined' ? 'Declining...' : 'Decline'}
                    </button>
                    <button
                      onClick={() => handleActionSharedIou(iou.id, 'accepted')}
                      disabled={isProcessing}
                      className="px-4 py-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl font-medium active:scale-95 transition-all border border-emerald-500/20"
                    >
                      {isProcessing && actioning?.action === 'accepted' ? 'Accepting...' : 'Accept'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="space-y-4 pt-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search IOUs..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-background border border-border/60 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-foreground transition-colors"
          />
        </div>

        {/* Restrained segmented filters */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1 border-b border-border/40">
          {(['all', 'owed_to_me', 'i_owe', 'settled'] as const).map(tab => {
            const labels = {
              all: 'All',
              owed_to_me: 'Owed to me',
              i_owe: 'I owe',
              settled: 'Settled'
            };
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${isActive ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Unified List */}
      <div className="pt-2">
        <div className="flex flex-col">
          {filteredIous.map(iou => {
            const isTheyOweMe = iou.direction === 'theyOweMe';
            const isSettled = iou.status === 'settled';
            const isPending = iou.status === 'pending';
            const amountColor = isSettled ? 'text-muted-foreground' : isTheyOweMe ? 'text-emerald-500' : 'text-amber-500';

            return (
              <div
                key={iou.id}
                onClick={() => {
                  if (iou.source === 'local' && !isPending) {
                    setSelectedDebtForSettlement(iou.rawDebt!);
                  }
                }}
                className={`py-4 border-b border-border/40 last:border-0 flex flex-col gap-2 transition-colors ${iou.source === 'local' && !isPending ? 'cursor-pointer hover:bg-muted/10 -mx-3 px-3 sm:rounded-xl sm:mx-0 sm:px-2' : ''}`}
              >
                <div className="flex items-start justify-between gap-4 w-full">
                  <div className="flex-1 min-w-0 pt-0.5">
                  <p className={`text-base font-medium truncate mb-0.5 ${isSettled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {iou.personName}
                  </p>

                  {iou.description && (
                    <p className="text-sm text-foreground/80 truncate mb-1">
                      {iou.description}
                    </p>
                  )}

                  <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                    {isPending ? (
                      `Waiting for ${iou.username ? `@${iou.username}` : iou.personName} · Pending`
                    ) : (
                      <>
                        {isTheyOweMe ? 'They owe me' : 'I owe them'}
                        {iou.isShared ? ' · Shared' : ''}
                        {iou.date > 0 ? ` · ${new Date(iou.date).toLocaleDateString()}` : ''}
                      </>
                    )}
                  </p>
                  {iou.pendingTotal !== undefined && iou.pendingTotal > 0 && (
                    <p className="text-[11px] sm:text-xs text-amber-500 font-medium truncate mt-0.5">
                      Payment pending · {iou.currency} {iou.pendingTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0 flex flex-col items-end">
                  <p className={`text-xl sm:text-2xl font-medium tracking-tight ${amountColor}`}>
                    <MaskedAmount amount={iou.amount} prefix={`${iou.currency} `} />
                  </p>
                  {canProposePayment(iou.source, iou.status, iou.direction, iou.availableToPropose || 0) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setProposePaymentIou(iou); }}
                      className="mt-2 text-[11px] sm:text-xs font-medium text-accent-foreground/80 hover:text-accent-foreground border border-border/80 hover:border-accent/40 rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      I paid
                    </button>
                  )}
                </div>
                </div>

                {iou.pendingSettlements && iou.pendingSettlements.length > 0 && canReviewPayment(iou.source, iou.status, iou.direction) && (
                  <div className="w-full">
                    {iou.pendingSettlements.map(s => (
                      <CreditorSettlementReview key={s.id} settlement={s} currency={iou.currency} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty States */}
          {filteredIous.length === 0 && (
            <div className="text-center py-16 px-4 space-y-3">
              <p className="text-sm font-medium text-muted-foreground">No IOUs here.</p>
              {!searchQuery && (
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-accent-foreground/80 hover:text-accent-foreground text-sm font-medium transition-colors"
                >
                  <Plus size={16} />
                  <span>Record a Debt</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AddDebtModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />

      <SettleDebtModal
        debt={selectedDebtForSettlement}
        isOpen={Boolean(selectedDebtForSettlement)}
        onClose={() => setSelectedDebtForSettlement(null)}
      />

      {proposePaymentIou && (
        <ProposePaymentModal
          isOpen={!!proposePaymentIou}
          onClose={() => setProposePaymentIou(null)}
          iouId={proposePaymentIou.id}
          personName={proposePaymentIou.personName}
          remainingAmount={proposePaymentIou.amount}
          availableToPropose={proposePaymentIou.availableToPropose || 0}
          pendingTotal={proposePaymentIou.pendingTotal || 0}
          currency={proposePaymentIou.currency}
        />
      )}
    </div>
  );
}
