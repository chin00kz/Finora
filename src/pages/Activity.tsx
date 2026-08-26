import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Transaction } from '../db/db';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { Filter } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import TransactionEditSheet from '../components/TransactionEditSheet';

export default function Activity() {
  const location = useLocation();
  const initStart = location.state?.filterStartDate;
  const initEnd = location.state?.filterEndDate;
  const initName = location.state?.filterName;
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const tags = useLiveQuery(() => db.tags.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  const [isFilterOpen, setIsFilterOpen] = useState(!!initStart);
  
  // Filter States
  const [filterType, setFilterType] = useState<string>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterDatePreset, setFilterDatePreset] = useState<string>(initStart ? 'custom' : 'all');
  const [filterCustomStart] = useState<number | null>(initStart || null);
  const [filterCustomEnd] = useState<number | null>(initEnd || null);
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);

  const getCategory = (id?: string) => categories.find(c => c.id === id);
  const getTag = (id: string) => tags.find(t => t.id === id);

  // Apply filters
  const filteredTransactions = transactions.filter(txn => {
    if (filterType !== 'all' && txn.type !== filterType) return false;
    
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

  const activeFilterCount = (filterType !== 'all' ? 1 : 0) + 
    (filterTags.length > 0 ? 1 : 0) + 
    (filterCategories.length > 0 ? 1 : 0) + 
    (filterAccounts.length > 0 ? 1 : 0) + 
    (filterDatePreset !== 'all' ? 1 : 0) + 
    (filterMinAmount || filterMaxAmount ? 1 : 0);

  const clearFilters = () => {
    setFilterType('all');
    setFilterTags([]);
    setFilterCategories([]);
    setFilterAccounts([]);
    setFilterDatePreset('all');
    setFilterMinAmount('');
    setFilterMaxAmount('');
  };

  const toggleArrayFilter = (current: string[], val: string, setter: (val: string[]) => void) => {
    if (current.includes(val)) {
      setter(current.filter(i => i !== val));
    } else {
      setter([...current, val]);
    }
  };

  // Group by day
  const grouped = [...filteredTransactions].sort((a, b) => b.date - a.date).reduce((acc, txn) => {
    const day = format(new Date(txn.date), 'MMM d, yyyy');
    if (!acc[day]) acc[day] = [];
    acc[day].push(txn);
    return acc;
  }, {} as Record<string, typeof transactions>);

  return (
    <div className="p-6 pb-24">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-medium text-gray-900">Activity</h2>
        <button 
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center transition-colors ${
            activeFilterCount > 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'
          }`}
        >
          <Filter size={16} className="mr-1.5" /> 
          Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
        </button>
      </div>
      
      {/* Filters Bar */}
      {isFilterOpen && (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm mb-6 animate-in slide-in-from-top-4 fade-in duration-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-medium text-gray-900">Filter Transactions</h3>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs font-medium text-gray-500 hover:text-gray-900">
                Clear all
              </button>
            )}
          </div>

          <div className="space-y-5">
            {/* Type */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Type</label>
              <div className="flex bg-gray-50 p-1 rounded-xl">
                {['all', 'expense', 'income', 'transfer'].map(t => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                      filterType === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Date</label>
              <select 
                value={filterDatePreset} 
                onChange={e => setFilterDatePreset(e.target.value)}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 outline-none"
              >
                <option value="all">Any time</option>
                <option value="7days">Last 7 days</option>
                <option value="30days">Last 30 days</option>
                <option value="thismonth">This month</option>
                {filterDatePreset === 'custom' && <option value="custom">Budget: {initName}</option>}
              </select>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Tags</label>
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => toggleArrayFilter(filterTags, tag.id, setFilterTags)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        filterTags.includes(tag.id) ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      #{tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Accounts */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Accounts</label>
              <div className="flex flex-wrap gap-2">
                {accounts.map(acc => (
                  <button
                    key={acc.id}
                    onClick={() => toggleArrayFilter(filterAccounts, acc.id, setFilterAccounts)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      filterAccounts.includes(acc.id) ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {acc.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Min LKR</label>
                <input 
                  type="number" 
                  value={filterMinAmount} 
                  onChange={e => setFilterMinAmount(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none" 
                  placeholder="0"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Max LKR</label>
                <input 
                  type="number" 
                  value={filterMaxAmount} 
                  onChange={e => setFilterMaxAmount(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none" 
                  placeholder="Any"
                />
              </div>
            </div>

          </div>
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([day, txns]) => (
          <div key={day}>
            <h3 className="text-sm font-medium text-gray-500 mb-3">{day}</h3>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {txns.map((txn, i) => {
                const category = getCategory(txn.categoryId);
                return (
                  <div
                    key={txn.id}
                    onClick={() => setSelectedTxn(txn)}
                    className={`p-4 flex items-center justify-between cursor-pointer active:bg-gray-50 transition-colors ${i !== txns.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <div className="flex items-center">
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center text-lg mr-3"
                        style={{ backgroundColor: category?.color ? `${category.color}20` : '#f3f4f6', color: category?.color || '#374151' }}
                      >
                        {txn.type === 'expense' ? '💸' : txn.type === 'income' ? '💰' : '🔄'}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{txn.notes || category?.name || (txn.type === 'transfer' ? 'Transfer' : 'Transaction')}</p>
                        {txn.tagIds && txn.tagIds.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {txn.tagIds.map(tid => {
                              const t = getTag(tid);
                              return t ? <span key={tid} className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">#{t.name}</span> : null;
                            })}
                          </div>
                        )}
                        {txn.isShared && <p className="text-xs text-blue-600 font-medium mt-1">Split • Your share: LKR {txn.personalAmount}</p>}
                      </div>
                    </div>
                    <div className={`font-medium ${txn.type === 'expense' ? 'text-gray-900' : txn.type === 'income' ? 'text-green-600' : 'text-gray-500'}`}>
                      {txn.type === 'expense' ? '-' : txn.type === 'income' ? '+' : ''}LKR {txn.amount.toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(grouped).length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-500">No activity found.</p>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="mt-3 text-sm font-medium text-gray-900 underline">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Transaction edit/delete sheet */}
      {selectedTxn && (
        <TransactionEditSheet
          transaction={selectedTxn}
          onClose={() => setSelectedTxn(null)}
        />
      )}
    </div>
  );
}
