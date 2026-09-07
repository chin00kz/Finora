import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Debt } from '../db/db';
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

type FilterTab = 'all' | 'owed_to_me' | 'i_owe' | 'settled';

export default function Debts() {
  const debts = useLiveQuery(() => db.debts.toArray()) || [];

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
              {debtMetrics.totalOwedToMe.toLocaleString()}
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
              {debtMetrics.totalIOwe.toLocaleString()}
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
              {debtMetrics.netBalance > 0 ? '+' : ''}
              {debtMetrics.netBalance.toLocaleString()}
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
                    LKR {remainingAmount.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    of LKR {debt.amount.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Progress bar if partially settled */}
              {(settledAmount > 0 || isFullySettled) && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Settled: LKR {settledAmount.toLocaleString()} ({progressPercent}%)</span>
                    <span>Remaining: LKR {remainingAmount.toLocaleString()}</span>
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
