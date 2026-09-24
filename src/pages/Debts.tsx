import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Debt } from '../db/db';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import { syncSharedIous } from '../sync/sharedIouSync';
import {
  Plus,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Receipt,
  Scale,
} from 'lucide-react';
import AddDebtModal from '../components/AddDebtModal';
import SettleDebtModal from '../components/SettleDebtModal';
import { getDebtSettlementStatus, reconcileSharedExpenses } from '../utils/debtSettlementEngine';
import MaskedAmount from '../components/MaskedAmount';

type FilterTab = 'all' | 'owed_to_me' | 'i_owe' | 'settled';

export default function Debts() {
  const debts = useLiveQuery(() => db.debts.toArray()) || [];

  // Phase 2D: Shared IOUs (Cloud)
  const sharedIous = useLiveQuery(() => db.cacheSharedIous.toArray()) || [];
  const cachedProfiles = useLiveQuery(() => db.cacheProfiles.toArray()) || [];
  const { user } = useAuthStore();

  const [actioningIouId, setActioningIouId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionedIous, setActionedIous] = useState<Record<string, string>>({}); // id -> 'accepted' | 'declined'

  // Fetch missing profiles for Shared IOUs
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
      // Securely fetch missing profiles via the connections RPC (since IOUs only come from connected friends)
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
          console.error("Failed to securely fetch profiles for shared IOUs", err);
        }
      };
      fetchProfiles();
    }
  }, [sharedIous, cachedProfiles, user]);

  // Initial load sync
  useEffect(() => {
    if (user) {
      syncSharedIous().catch(e => console.error("Initial shared IOU sync failed", e));
    }
  }, [user]);

  const handleActionSharedIou = async (iouId: string, action: 'accepted' | 'declined') => {
    if (!user || actioningIouId) return;
    setActioningIouId(iouId);
    setActionError(null);

    const rpcName = action === 'accepted' ? 'accept_shared_iou' : 'decline_shared_iou';

    try {
      const { error } = await supabase.rpc(rpcName, { p_iou_id: iouId });
      if (error) throw error;

      // Mutation succeeded! Reflect locally
      setActionedIous(prev => ({ ...prev, [iouId]: action }));

      // Refresh cache
      const res = await syncSharedIous();
      if (!res.success) {
        console.warn('Post-mutation cache refresh failed. UI state preserved locally.', res.error);
      }
    } catch (err: any) {
      console.error(`Failed to ${action} shared IOU`, err);
      setActionError(err.message || `Failed to ${action} request. Please try again.`);
    } finally {
      setActioningIouId(null);
    }
  };

  const incomingRequests = sharedIous.filter(iou => iou.status === 'pending' && iou.debtor_id === user?.id && !actionedIous[iou.id]);
  const acceptedSharedIous = sharedIous.filter(iou => (iou.status === 'accepted' || actionedIous[iou.id] === 'accepted'));


  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedDebtForSettlement, setSelectedDebtForSettlement] = useState<Debt | null>(null);

  // Auto-reconcile any shared transactions from the activity log into db.debts
  useEffect(() => {
    reconcileSharedExpenses();
  }, []);

  // Compute calculated metrics for all debts
  const debtMetrics = useMemo(() => {
    let totalOwedToMe = 0;
    let totalIOwe = 0;
    let settledCount = 0;

    for (const d of debts) {
      const { remainingAmount, isFullySettled } = getDebtSettlementStatus(d);
      if (isFullySettled) {
        settledCount++;
      } else {
        if (d.direction === 'theyOweMe') {
          totalOwedToMe += remainingAmount;
        } else {
          totalIOwe += remainingAmount;
        }
      }
    }

    const netBalance = totalOwedToMe - totalIOwe;

    return {
      totalOwedToMe,
      totalIOwe,
      netBalance,
      settledCount,
      activeCount: debts.length - settledCount,
    };
  }, [debts]);

  // Filter and sort debts
  const filteredDebts = useMemo(() => {
    return debts
      .filter(d => {
        const { isFullySettled } = getDebtSettlementStatus(d);

        // Tab filter
        if (activeTab === 'owed_to_me') {
          if (d.direction !== 'theyOweMe' || isFullySettled) return false;
        } else if (activeTab === 'i_owe') {
          if (d.direction !== 'iOweThem' || isFullySettled) return false;
        } else if (activeTab === 'settled') {
          if (!isFullySettled) return false;
        } else if (activeTab === 'all') {
          // In "all", show active debts first, settled still visible
        }

        // Search filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const match =
            d.personName?.toLowerCase().includes(q) ||
            d.note?.toLowerCase().includes(q) ||
            String(d.amount).includes(q);
          if (!match) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const statusA = getDebtSettlementStatus(a);
        const statusB = getDebtSettlementStatus(b);

        // Active first, settled last
        if (statusA.isFullySettled !== statusB.isFullySettled) {
          return statusA.isFullySettled ? 1 : -1;
        }
        return (b.date || 0) - (a.date || 0);
      });
  }, [debts, activeTab, searchQuery]);

  return (
    <div className="p-6 pb-28 max-w-5xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-medium text-foreground tracking-tight">IOUs & Debts</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage shared expenses, manual IOUs, and flexible settlements
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-accent-foreground rounded-xl text-sm font-medium shadow-sm hover:opacity-90 active:scale-95 transition-all self-start sm:self-auto"
        >
          <Plus size={16} />
          <span>Record Debt</span>
        </button>
      </div>

      {/* Phase 2D: Shared IOU Requests */}
      {incomingRequests.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Shared IOU Requests</h4>
          {actionError && <p className="text-sm text-red-500 px-1">{actionError}</p>}
          <div className="grid gap-3">
            {incomingRequests.map(iou => {
              const creator = cachedProfiles.find(p => p.id === iou.creator_id);
              const name = creator?.display_name || "Unknown";
              const username = creator?.username ? `@${creator.username}` : "";
              const isProcessing = actioningIouId === iou.id;

              return (
                <div key={iou.id} className={`bg-card rounded-2xl p-4 border border-border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <p className="font-medium text-sm text-foreground">
                      {name} <span className="text-xs text-muted-foreground font-normal ml-1">{username}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      requests <span className="font-medium text-foreground">{iou.currency} {iou.amount.toLocaleString()}</span>
                      {iou.description && <span className="ml-1 opacity-80">&bull; {iou.description}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleActionSharedIou(iou.id, 'declined')}
                      disabled={isProcessing}
                      className="px-4 py-2 bg-secondary text-secondary-foreground text-xs rounded-xl font-medium"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => handleActionSharedIou(iou.id, 'accepted')}
                      disabled={isProcessing}
                      className="px-4 py-2 bg-primary text-primary-foreground text-xs rounded-xl font-medium"
                    >
                      Accept
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* You're Owed Card */}
        <div className="bg-card rounded-2xl p-5 border border-border shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              You're Owed
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <ArrowDownLeft size={16} />
            </div>
          </div>
          <div>
            <p className="text-2xl font-medium text-emerald-500">
              <span className="text-sm mr-1 font-normal text-muted-foreground">LKR</span>
              <MaskedAmount amount={debtMetrics.totalOwedToMe} />
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Pending receivables</p>
          </div>
        </div>

        {/* You Owe Card */}
        <div className="bg-card rounded-2xl p-5 border border-border shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              You Owe
            </span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <ArrowUpRight size={16} />
            </div>
          </div>
          <div>
            <p className="text-2xl font-medium text-amber-500">
              <span className="text-sm mr-1 font-normal text-muted-foreground">LKR</span>
              <MaskedAmount amount={debtMetrics.totalIOwe} />
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Pending payables</p>
          </div>
        </div>

        {/* Net Balance Card */}
        <div className="bg-card rounded-2xl p-5 border border-border shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Net Balance
            </span>
            <div className="w-7 h-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
              <Scale size={16} />
            </div>
          </div>
          <div>
            <p
              className={`text-2xl font-medium ${
                debtMetrics.netBalance > 0
                  ? 'text-emerald-500'
                  : debtMetrics.netBalance < 0
                  ? 'text-amber-500'
                  : 'text-foreground'
              }`}
            >
              <span className="text-sm mr-1 font-normal text-muted-foreground">LKR</span>
              <MaskedAmount amount={debtMetrics.netBalance} showSign />
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {debtMetrics.netBalance > 0
                ? 'Overall in your favor'
                : debtMetrics.netBalance < 0
                ? 'Overall you owe more'
                : 'All balanced'}
            </p>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        {/* Tabs */}
        <div className="flex bg-muted p-1 rounded-xl gap-1 overflow-x-auto">
          {[
            { key: 'all', label: 'All Debts' },
            { key: 'owed_to_me', label: "You're Owed" },
            { key: 'i_owe', label: 'You Owe' },
            { key: 'settled', label: `Settled (${debtMetrics.settledCount})` },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as FilterTab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[220px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search person or note…"
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-xs font-medium text-foreground outline-none focus:border-foreground"
          />
        </div>
      </div>

      {/* Debts List */}
      <div className="space-y-3">
        {filteredDebts.map(debt => {
          const isTheyOweMe = debt.direction === 'theyOweMe';
          const { remainingAmount, settledAmount, isFullySettled, progressPercent } =
            getDebtSettlementStatus(debt);

          return (
            <div
              key={debt.id}
              className={`p-4 sm:p-5 bg-card border border-border rounded-2xl shadow-xs transition-all hover:border-foreground/20 flex flex-col gap-3 ${
                isFullySettled ? 'opacity-70 bg-muted/20' : ''
              }`}
            >
              {/* Top Row: Person & Direction Badge */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  {/* Avatar / Icon circle */}
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-medium text-sm ${
                      isTheyOweMe
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {debt.personName ? debt.personName.slice(0, 1).toUpperCase() : '?'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground text-base">
                        {debt.personName || 'Unnamed'}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          isTheyOweMe
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {isTheyOweMe ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
                        {isTheyOweMe ? "They owe you" : "You owe them"}
                      </span>
                      {debt.source === 'shared_expense' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-500">
                          <Receipt size={10} />
                          Shared Expense
                        </span>
                      )}
                      {isFullySettled && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                          <CheckCircle2 size={11} className="text-emerald-500" />
                          Settled
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span>{new Date(debt.date).toLocaleDateString()}</span>
                      {debt.note && <span>· {debt.note}</span>}
                    </div>
                  </div>
                </div>

                {/* Amount Column */}
                <div className="text-right shrink-0">
                  <p
                    className={`font-semibold text-lg ${
                      isFullySettled
                        ? 'text-muted-foreground line-through'
                        : isTheyOweMe
                        ? 'text-emerald-500'
                        : 'text-amber-500'
                    }`}
                  >
                    <MaskedAmount amount={remainingAmount} prefix="LKR " />
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    of <MaskedAmount amount={debt.amount} prefix="LKR " />
                  </p>
                </div>
              </div>

              {/* Progress bar if partially settled */}
              {(settledAmount > 0 || isFullySettled) && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>
                      Settled: <MaskedAmount amount={settledAmount} prefix="LKR " /> ({progressPercent}%)
                    </span>
                    <span>
                      Remaining: <MaskedAmount amount={remainingAmount} prefix="LKR " />
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isFullySettled
                          ? 'bg-emerald-500'
                          : isTheyOweMe
                          ? 'bg-emerald-500'
                          : 'bg-amber-500'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons Row */}
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
                <button
                  onClick={() => setSelectedDebtForSettlement(debt)}
                  className={`px-4 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                    isFullySettled
                      ? 'bg-muted text-muted-foreground hover:text-foreground'
                      : isTheyOweMe
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                  }`}
                >
                  {isFullySettled ? 'View History / Undo' : 'Settle Debt'}
                </button>
              </div>
            </div>
          );
        })}

        {/* Empty States */}
        {filteredDebts.length === 0 && (
          <div className="text-center py-16 px-4 bg-card border border-dashed border-border rounded-2xl space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <Receipt size={22} />
            </div>
            <h3 className="font-medium text-foreground text-sm">
              {searchQuery ? 'No matching debts found' : 'No debts in this tab'}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {searchQuery
                ? 'Try a different search query or clear the filter.'
                : 'Log personal loans or IOUs easily when someone covers an expense or you spot a friend.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-medium shadow-xs hover:opacity-90 transition-opacity"
              >
                <Plus size={14} />
                <span>Record a Debt</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Phase 2D: Accepted Shared IOUs */}
      {acceptedSharedIous.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-border/50 mt-6">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Shared IOUs</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {acceptedSharedIous.map(iou => {
              const otherId = iou.creator_id === user?.id ? iou.debtor_id : iou.creditor_id;
              const otherProf = cachedProfiles.find(p => p.id === otherId);
              const name = otherProf?.display_name || "Unknown";
              const isTheyOweMe = iou.creditor_id === user?.id;

              return (
                <div key={iou.id} className="bg-card rounded-2xl p-5 border border-border shadow-xs flex flex-col gap-4 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4">
                    <div className="w-8 h-8 rounded-full bg-accent/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Receipt size={14} className="text-muted-foreground" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {name}
                      </p>
                      <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded font-medium uppercase tracking-widest">Shared</span>
                    </div>
                    <p className={`text-2xl font-medium ${isTheyOweMe ? 'text-emerald-500' : 'text-amber-500'}`}>
                      <span className="text-sm mr-1 font-normal text-muted-foreground">{iou.currency}</span>
                      {iou.amount.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {isTheyOweMe ? 'They owe me' : 'I owe them'}
                    </p>
                  </div>
                  {iou.description && (
                    <div className="bg-muted/50 p-3 rounded-xl border border-border/50">
                      <p className="text-xs text-foreground italic">"{iou.description}"</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
    </div>
  );
}
