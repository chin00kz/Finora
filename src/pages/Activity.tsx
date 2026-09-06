import { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Transaction } from '../db/db';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import {
  Filter,
  Search,
  CheckSquare,
  Square,
  Trash2,
  Tag as TagIcon,
  FolderInput,
  X,
  ChevronDown,
  UploadCloud,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import TransactionEditSheet from '../components/TransactionEditSheet';
import ImportDataModal from '../components/ImportDataModal';
import { triggerSync, deleteFromCloud } from '../sync/syncEngine';

export default function Activity() {
  const location = useLocation();
  const initStart = location.state?.filterStartDate;
  const initEnd = location.state?.filterEndDate;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const tags = useLiveQuery(() => db.tags.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(!!initStart);

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkCategoryMenu, setShowBulkCategoryMenu] = useState(false);
  const [showBulkTagMenu, setShowBulkTagMenu] = useState(false);

  // Filter States
  const [filterType, setFilterType] = useState<string>('all');
  const [filterBudgetStatus, setFilterBudgetStatus] = useState<'all' | 'budgeted' | 'out_of_budget'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterDatePreset, setFilterDatePreset] = useState<string>(initStart ? 'custom' : 'all');
  const [filterCustomStart] = useState<number | null>(initStart || null);
  const [filterCustomEnd] = useState<number | null>(initEnd || null);
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);

  // Global / shortcut listener to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getCategory = (id?: string) => categories.find(c => c.id === id);
  const getTag = (id: string) => tags.find(t => t.id === id);
  const getAccount = (id: string) => accounts.find(a => a.id === id);

  // Apply filters & search
  const filteredTransactions = transactions.filter(txn => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const cat = getCategory(txn.categoryId);
      const acc = getAccount(txn.accountId);
      const match =
        txn.notes?.toLowerCase().includes(q) ||
        cat?.name.toLowerCase().includes(q) ||
        acc?.name.toLowerCase().includes(q) ||
        String(txn.amount).includes(q);
      if (!match) return false;
    }

    if (filterType !== 'all' && txn.type !== filterType) return false;
    if (filterBudgetStatus === 'budgeted' && (txn.type !== 'expense' || txn.excludeFromBudget)) return false;
    if (filterBudgetStatus === 'out_of_budget' && (txn.type !== 'expense' || !txn.excludeFromBudget)) return false;

    if (filterTags.length > 0) {
      if (!txn.tagIds || !filterTags.some(tagId => txn.tagIds!.includes(tagId))) return false;
    }

    if (filterCategories.length > 0) {
      if (!txn.categoryId || !filterCategories.includes(txn.categoryId)) return false;
    }

    if (filterAccounts.length > 0) {
      if (!filterAccounts.includes(txn.accountId)) return false;
    }

    if (filterMinAmount && txn.amount < Number(filterMinAmount)) return false;
    if (filterMaxAmount && txn.amount > Number(filterMaxAmount)) return false;

    if (filterDatePreset !== 'all') {
      const now = new Date();
      let start = 0;
      let end = now.getTime();

      if (filterDatePreset === '7days') start = subDays(now, 7).getTime();
      if (filterDatePreset === '30days') start = subDays(now, 30).getTime();
      if (filterDatePreset === 'thismonth') {
        start = startOfMonth(now).getTime();
        end = endOfMonth(now).getTime();
      }
      if (filterDatePreset === 'custom') {
        if (filterCustomStart) start = filterCustomStart;
        if (filterCustomEnd) end = filterCustomEnd;
      }

      if (txn.date < start || txn.date > end) return false;
    }

    return true;
  });

  const activeFilterCount =
    (filterType !== 'all' ? 1 : 0) +
    (filterBudgetStatus !== 'all' ? 1 : 0) +
    (filterTags.length > 0 ? 1 : 0) +
    (filterCategories.length > 0 ? 1 : 0) +
    (filterAccounts.length > 0 ? 1 : 0) +
    (filterDatePreset !== 'all' ? 1 : 0) +
    (filterMinAmount || filterMaxAmount ? 1 : 0);

  const clearFilters = () => {
    setFilterType('all');
    setFilterBudgetStatus('all');
    setFilterTags([]);
    setFilterCategories([]);
    setFilterAccounts([]);
    setFilterDatePreset('all');
    setFilterMinAmount('');
    setFilterMaxAmount('');
    setSearchQuery('');
  };

  const toggleArrayFilter = (current: string[], val: string, setter: (val: string[]) => void) => {
    if (current.includes(val)) {
      setter(current.filter(i => i !== val));
    } else {
      setter([...current, val]);
    }
  };

  // Bulk action handlers
  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTransactions.map(t => t.id)));
    }
  };

  const handleToggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Permanently delete ${selectedIds.size} transactions?`)) return;

    const idsToDelete = Array.from(selectedIds);
    const txnsToDelete = transactions.filter(t => idsToDelete.includes(t.id));

    await db.transaction('rw', [db.transactions, db.accounts], async () => {
      // Revert account balances
      for (const txn of txnsToDelete) {
        const acc = await db.accounts.get(txn.accountId);
        if (acc) {
          const delta = txn.type === 'expense' ? txn.amount : txn.type === 'income' ? -txn.amount : 0;
          await db.accounts.update(txn.accountId, {
            balance: acc.balance + delta,
            updatedAt: Date.now(),
          });
        }
      }
      await db.transactions.bulkDelete(idsToDelete);
    });

    for (const id of idsToDelete) {
      await deleteFromCloud('transactions', id);
    }
    triggerSync();
    setSelectedIds(new Set());
  };

  const handleBulkSetCategory = async (categoryId: string) => {
    const ids = Array.from(selectedIds);
    await db.transaction('rw', db.transactions, async () => {
      for (const id of ids) {
        await db.transactions.update(id, {
          categoryId: categoryId || undefined,
          updatedAt: Date.now(),
        });
      }
    });
    triggerSync();
    setShowBulkCategoryMenu(false);
    setSelectedIds(new Set());
  };

  const handleBulkAddTag = async (tagId: string) => {
    const ids = Array.from(selectedIds);
    await db.transaction('rw', db.transactions, async () => {
      for (const id of ids) {
        const txn = await db.transactions.get(id);
        if (txn) {
          const existing = txn.tagIds || [];
          if (!existing.includes(tagId)) {
            await db.transactions.update(id, {
              tagIds: [...existing, tagId],
              updatedAt: Date.now(),
            });
          }
        }
      }
    });
    triggerSync();
    setShowBulkTagMenu(false);
  };

  // Group by day for mobile view
  const grouped = [...filteredTransactions]
    .sort((a, b) => b.date - a.date)
    .reduce((acc, txn) => {
      const day = format(new Date(txn.date), 'MMM d, yyyy');
      if (!acc[day]) acc[day] = [];
      acc[day].push(txn);
      return acc;
    }, {} as Record<string, typeof transactions>);

  return (
    <div className="p-6 pb-28 max-w-5xl mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-medium text-foreground">Activity</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filteredTransactions.length} transaction{filteredTransactions.length === 1 ? '' : 's'} recorded
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Search bar with / indicator */}
          <div className="relative flex-1 sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search activity... (/)"
              className="w-full pl-9 pr-8 py-2 bg-card border border-border rounded-xl text-xs font-medium text-foreground outline-none focus:border-foreground transition-all shadow-sm"
            />
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            ) : (
              <kbd className="hidden sm:inline-block absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border">
                /
              </kbd>
            )}
          </div>

          {/* Import CSV button */}
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3 py-2 rounded-xl text-xs font-medium flex items-center bg-card border border-border text-foreground hover:bg-muted active:scale-95 transition-all shadow-sm"
            title="Import transactions from CSV"
          >
            <UploadCloud size={14} className="mr-1.5 text-muted-foreground" />
            <span>Import</span>
          </button>

          {/* Filter toggle button */}
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center transition-colors shadow-sm ${
              activeFilterCount > 0 ? 'bg-accent text-accent-foreground' : 'bg-card border border-border text-foreground'
            }`}
          >
            <Filter size={14} className="mr-1.5" />
            <span>Filters</span>
            {activeFilterCount > 0 && <span className="ml-1">({activeFilterCount})</span>}
          </button>
        </div>
      </div>

      {/* Bulk Action Sticky Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 p-3 bg-card border border-border rounded-2xl shadow-md flex items-center justify-between gap-2 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="flex items-center gap-2.5 text-xs font-medium text-foreground">
            <button onClick={handleToggleSelectAll} className="p-1 hover:text-foreground">
              {selectedIds.size === filteredTransactions.length ? (
                <CheckSquare size={16} className="text-accent" />
              ) : (
                <Square size={16} className="text-muted-foreground" />
              )}
            </button>
            <span>{selectedIds.size} selected</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Re-categorize dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowBulkCategoryMenu(!showBulkCategoryMenu)}
                className="px-2.5 py-1.5 bg-muted hover:bg-muted/80 rounded-xl text-xs font-medium flex items-center gap-1.5 text-foreground transition-colors"
              >
                <FolderInput size={14} />
                <span className="hidden sm:inline">Change Category</span>
                <ChevronDown size={12} />
              </button>
              {showBulkCategoryMenu && (
                <div className="absolute right-0 mt-1 w-44 bg-card border border-border rounded-xl shadow-lg p-1 z-30 space-y-0.5">
                  <button
                    onClick={() => handleBulkSetCategory('')}
                    className="w-full text-left px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded-lg"
                  >
                    No Category
                  </button>
                  {categories.map(c => (
                    <button
                      key={c.id}
                      onClick={() => handleBulkSetCategory(c.id)}
                      className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted rounded-lg flex items-center gap-2"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Add Tag dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowBulkTagMenu(!showBulkTagMenu)}
                className="px-2.5 py-1.5 bg-muted hover:bg-muted/80 rounded-xl text-xs font-medium flex items-center gap-1.5 text-foreground transition-colors"
              >
                <TagIcon size={14} />
                <span className="hidden sm:inline">Add Tag</span>
                <ChevronDown size={12} />
              </button>
              {showBulkTagMenu && (
                <div className="absolute right-0 mt-1 w-44 bg-card border border-border rounded-xl shadow-lg p-1 z-30 space-y-0.5">
                  {tags.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No tags defined</p>
                  ) : (
                    tags.map(t => (
                      <button
                        key={t.id}
                        onClick={() => handleBulkAddTag(t.id)}
                        className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted rounded-lg truncate"
                      >
                        #{t.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Delete button */}
            <button
              onClick={handleBulkDelete}
              className="px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>

            {/* Deselect */}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg"
              title="Clear selection"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      {isFilterOpen && (
        <div className="bg-card rounded-2xl p-5 border border-border shadow-sm mb-6 animate-in slide-in-from-top-4 fade-in duration-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-medium text-foreground text-sm">Filter Transactions</h3>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs font-medium text-muted-foreground hover:text-foreground underline"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="space-y-4">
            {/* Type Filter */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Type
              </label>
              <div className="flex bg-muted p-1 rounded-xl">
                {['all', 'expense', 'income', 'transfer'].map(t => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                      filterType === t ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Budget Tracking Status */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Budget Impact
              </label>
              <div className="flex bg-muted p-1 rounded-xl">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'budgeted', label: 'In Budget' },
                  { id: 'out_of_budget', label: '⚡ Out of Budget' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setFilterBudgetStatus(opt.id as 'all' | 'budgeted' | 'out_of_budget')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      filterBudgetStatus === opt.id
                        ? 'bg-card shadow-sm text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Preset */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Timeframe
              </label>
              <div className="flex bg-muted p-1 rounded-xl">
                {[
                  { id: 'all', label: 'All Time' },
                  { id: '7days', label: '7 Days' },
                  { id: '30days', label: '30 Days' },
                  { id: 'thismonth', label: 'This Month' },
                ].map(d => (
                  <button
                    key={d.id}
                    onClick={() => setFilterDatePreset(d.id)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      filterDatePreset === d.id
                        ? 'bg-card shadow-sm text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Accounts Filter */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Accounts
              </label>
              <div className="flex flex-wrap gap-2">
                {accounts.map(acc => {
                  const isSel = filterAccounts.includes(acc.id);
                  return (
                    <button
                      key={acc.id}
                      onClick={() => toggleArrayFilter(filterAccounts, acc.id, setFilterAccounts)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        isSel
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {acc.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Categories Filter */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Categories
              </label>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto hide-scrollbar">
                {categories.map(cat => {
                  const isSel = filterCategories.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      onClick={() => toggleArrayFilter(filterCategories, cat.id, setFilterCategories)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                        isSel
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Amount Range */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Min LKR
                </label>
                <input
                  type="number"
                  value={filterMinAmount}
                  onChange={e => setFilterMinAmount(e.target.value)}
                  className="w-full p-2.5 bg-background border border-border rounded-xl text-sm text-foreground font-medium outline-none focus:border-foreground"
                  placeholder="0"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Max LKR
                </label>
                <input
                  type="number"
                  value={filterMaxAmount}
                  onChange={e => setFilterMaxAmount(e.target.value)}
                  className="w-full p-2.5 bg-background border border-border rounded-xl text-sm text-foreground font-medium outline-none focus:border-foreground"
                  placeholder="Any"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DESKTOP VIEW: Structured Table Layout (`hidden md:block`) ───────── */}
      <div className="hidden md:block">
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="p-3.5 pl-4 w-10">
                  <button onClick={handleToggleSelectAll} className="hover:text-foreground">
                    {selectedIds.size > 0 && selectedIds.size === filteredTransactions.length ? (
                      <CheckSquare size={16} className="text-accent" />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                </th>
                <th className="p-3.5">Date & Time</th>
                <th className="p-3.5">Description</th>
                <th className="p-3.5">Category</th>
                <th className="p-3.5">Account</th>
                <th className="p-3.5">Tags & Status</th>
                <th className="p-3.5 text-right pr-5">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm font-normal">
              {filteredTransactions
                .sort((a, b) => b.date - a.date)
                .map(txn => {
                  const category = getCategory(txn.categoryId);
                  const account = getAccount(txn.accountId);
                  const isSelected = selectedIds.has(txn.id);

                  return (
                    <tr
                      key={txn.id}
                      onClick={() => setSelectedTxn(txn)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-muted/80' : 'hover:bg-muted/40'
                      }`}
                    >
                      <td className="p-3.5 pl-4" onClick={e => handleToggleSelectRow(txn.id, e)}>
                        {isSelected ? (
                          <CheckSquare size={16} className="text-accent" />
                        ) : (
                          <Square size={16} className="text-muted-foreground opacity-60 hover:opacity-100" />
                        )}
                      </td>
                      <td className="p-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        <div className="font-medium text-foreground">
                          {format(new Date(txn.date), 'MMM dd, yyyy')}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {format(new Date(txn.date), 'h:mm a')}
                        </div>
                      </td>
                      <td className="p-3.5 font-medium text-foreground max-w-xs truncate">
                        {txn.notes || category?.name || (txn.type === 'transfer' ? 'Transfer' : 'Transaction')}
                      </td>
                      <td className="p-3.5">
                        {category ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                            style={{
                              backgroundColor: `${category.color}18`,
                              color: category.color,
                            }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: category.color }} />
                            {category.name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3.5 text-xs text-foreground font-medium">
                        {account?.name || 'Unknown'}
                      </td>
                      <td className="p-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {txn.excludeFromBudget && (
                            <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium px-1.5 py-0.5 rounded">
                              ⚡ Out of budget
                            </span>
                          )}
                          {txn.isShared && (
                            <span className="text-[10px] bg-blue-500/10 text-blue-500 font-medium px-1.5 py-0.5 rounded">
                              Split
                            </span>
                          )}
                          {(txn.tagIds || []).map(tid => {
                            const t = getTag(tid);
                            return t ? (
                              <span
                                key={tid}
                                className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium"
                              >
                                #{t.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      </td>
                      <td
                        className={`p-3.5 pr-5 text-right font-medium whitespace-nowrap ${
                          txn.type === 'expense'
                            ? 'text-foreground'
                            : txn.type === 'income'
                            ? 'text-emerald-500'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {txn.type === 'expense' ? '−' : txn.type === 'income' ? '+' : ''}LKR{' '}
                        {txn.amount.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>

          {filteredTransactions.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No activity matching your filters.</p>
              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="mt-2 text-xs font-medium text-foreground underline">
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── MOBILE VIEW: Grouped Cards Layout (`md:hidden`) ─────────────────── */}
      <div className="md:hidden space-y-6">
        {Object.entries(grouped).map(([day, txns]) => (
          <div key={day}>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">{day}</h3>
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              {txns.map((txn, i) => {
                const category = getCategory(txn.categoryId);
                return (
                  <div
                    key={txn.id}
                    onClick={() => setSelectedTxn(txn)}
                    className={`p-4 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors ${
                      i !== txns.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <div className="flex items-center">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-lg mr-3 shrink-0"
                        style={{
                          backgroundColor: category?.color ? `${category.color}20` : 'var(--muted)',
                          color: category?.color || 'var(--foreground)',
                        }}
                      >
                        {txn.type === 'expense' ? '💸' : txn.type === 'income' ? '💰' : '🔄'}
                      </div>
                      <div>
                        <p className="font-medium text-foreground text-sm">
                          {txn.notes || category?.name || (txn.type === 'transfer' ? 'Transfer' : 'Transaction')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(txn.date), 'h:mm a')}
                          {category && txn.notes ? ` · ${category.name}` : ''}
                        </p>
                        {txn.tagIds && txn.tagIds.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {txn.tagIds.map(tid => {
                              const t = getTag(tid);
                              return t ? (
                                <span
                                  key={tid}
                                  className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                                >
                                  #{t.name}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 mt-1">
                          {txn.excludeFromBudget && (
                            <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium px-1.5 py-0.5 rounded">
                              ⚡ Out of budget
                            </span>
                          )}
                          {txn.isShared && (
                            <span className="text-xs text-blue-500 font-medium">
                              Split · Your share: LKR {txn.personalAmount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`font-medium text-sm ${
                        txn.type === 'expense'
                          ? 'text-foreground'
                          : txn.type === 'income'
                          ? 'text-emerald-500'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {txn.type === 'expense' ? '−' : txn.type === 'income' ? '+' : ''}LKR{' '}
                      {txn.amount.toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(grouped).length === 0 && (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">No activity found.</p>
            {activeFilterCount > 0 ? (
              <button onClick={clearFilters} className="text-sm font-medium text-foreground underline">
                Clear filters
              </button>
            ) : (
              <div className="pt-2">
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-medium shadow-sm hover:opacity-90 active:scale-95 transition-all"
                >
                  <UploadCloud size={14} />
                  <span>Import Backup CSV</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transaction edit/delete sheet */}
      {selectedTxn && (
        <TransactionEditSheet transaction={selectedTxn} onClose={() => setSelectedTxn(null)} />
      )}

      {/* Import CSV Modal */}
      <ImportDataModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  );
}
