import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Debt } from '../db/db';
import { Plus, Search } from 'lucide-react';
import AddDebtModal from '../components/AddDebtModal';
import SettleDebtModal from '../components/SettleDebtModal';
import { getDebtSettlementStatus } from '../utils/debtSettlementEngine';
import MaskedAmount from '../components/MaskedAmount';

type FilterTab = 'all' | 'owed_to_me' | 'i_owe' | 'settled';

interface UnifiedIou {
  id: string;
  source: 'local';
  personName: string;
  amount: number;
  originalAmount: number;
  currency: string;
  direction: 'theyOweMe' | 'iOweThem';
  description?: string;
  status: 'active' | 'settled' | 'pending';
  date: number;
  rawDebt?: Debt;
}

export default function Debts() {
  const debts = useLiveQuery(() => db.debts.toArray()) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedDebtForSettlement, setSelectedDebtForSettlement] = useState<Debt | null>(null);

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
        rawDebt: d
      });
    }

      return list;
    }, [debts]);

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
                className={`py-4 border-b border-border/40 last:border-0 flex items-start justify-between gap-4 transition-colors ${iou.source === 'local' && !isPending ? 'cursor-pointer hover:bg-muted/10 -mx-3 px-3 sm:rounded-xl sm:mx-0 sm:px-2' : ''}`}
              >
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
                    {isTheyOweMe ? 'They owe me' : 'I owe them'}
                    {iou.date > 0 ? ` · ${new Date(iou.date).toLocaleDateString()}` : ''}
                  </p>
                </div>

                <div className="text-right shrink-0 flex flex-col items-end">
                  <p className={`text-xl sm:text-2xl font-medium tracking-tight ${amountColor}`}>
                    <MaskedAmount amount={iou.amount} prefix={`${iou.currency} `} />
                  </p>
                </div>
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
    </div>
  );
}
