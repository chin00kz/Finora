import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AccountType } from '../db/db';
import { Plus, X, Trash2 } from 'lucide-react';

const ACCOUNT_TYPES: { id: AccountType; label: string; icon: string }[] = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'wallet', label: 'Wallet', icon: '👛' },
  { id: 'bank', label: 'Bank', icon: '🏦' },
  { id: 'card', label: 'Card', icon: '💳' },
  { id: 'savings', label: 'Savings', icon: 'piggy-bank' },
  { id: 'other', label: 'Other', icon: '📦' }
];

export default function Accounts() {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const totalBalance = accounts.filter(a => a.includeInTotal).reduce((sum, acc) => sum + acc.balance, 0);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [balance, setBalance] = useState('');
  const [includeInTotal, setIncludeInTotal] = useState(true);

  const openModal = (acc?: typeof accounts[0]) => {
    if (acc) {
      setEditingId(acc.id);
      setName(acc.name);
      setType(acc.type);
      setBalance(acc.balance.toString());
      setIncludeInTotal(acc.includeInTotal);
    } else {
      setEditingId(null);
      setName('');
      setType('bank');
      setBalance('');
      setIncludeInTotal(true);
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || isNaN(Number(balance))) return;

    if (editingId) {
      await db.accounts.update(editingId, {
        name,
        type,
        includeInTotal,
        // Only update balance if we allow manual override here (usually balance is derived, but we allow editing for simplicity)
        balance: Number(balance)
      });
    } else {
      await db.accounts.add({
        id: `acc-${Date.now()}`,
        name,
        type,
        balance: Number(balance),
        currency: 'LKR',
        includeInTotal
      });
    }
    setIsModalOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this account?')) {
      await db.accounts.delete(id);
      setIsModalOpen(false);
    }
  };

  const getIcon = (t: string) => ACCOUNT_TYPES.find(a => a.id === t)?.icon || '📦';

  return (
    <div className="p-6 pb-24">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-medium text-gray-900">Accounts</h2>
        <button 
          onClick={() => openModal()}
          className="bg-gray-100 text-gray-900 px-3 py-2 rounded-xl text-sm font-medium flex items-center active:scale-95 transition-transform"
        >
          <Plus size={16} className="mr-1" /> Add
        </button>
      </div>
      
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm mb-8">
        <p className="text-sm text-gray-500 font-medium mb-1">Net Worth</p>
        <p className="text-4xl font-light text-gray-900">
          <span className="text-2xl mr-1">LKR</span>
          {totalBalance.toLocaleString()}
        </p>
        <p className="text-xs text-gray-400 mt-2">Only includes accounts marked "Include in Total"</p>
      </div>

      <div className="space-y-3">
        {accounts.map(acc => (
          <div key={acc.id} onClick={() => openModal(acc)} className={`p-4 bg-white border rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-gray-50 transition-colors ${!acc.includeInTotal ? 'border-dashed border-gray-300 opacity-70' : 'border-gray-100'}`}>
            <div className="flex items-center">
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-lg mr-3 border border-gray-100">
                {getIcon(acc.type)}
              </div>
              <div>
                <p className="font-medium text-gray-900 flex items-center">
                  {acc.name} 
                  {!acc.includeInTotal && <span className="ml-2 text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 font-medium uppercase tracking-wider">Excluded</span>}
                </p>
                <p className="text-xs text-gray-500 capitalize">{acc.type}</p>
              </div>
            </div>
            <div className="font-medium text-gray-900">
              LKR {acc.balance.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col animate-in slide-in-from-bottom-full duration-300">
            <div className="flex justify-between items-center p-5 border-b border-gray-100">
              <h2 className="text-xl font-medium text-gray-900">{editingId ? 'Edit Account' : 'New Account'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-gray-100 rounded-full text-gray-500 active:scale-95">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-gray-900"
                  placeholder="e.g. HNB Savings"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {ACCOUNT_TYPES.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-colors ${
                        type === t.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600'
                      }`}
                    >
                      <span className="text-xl mb-1">{t.icon}</span>
                      <span className="text-xs font-medium">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Current Balance (LKR)</label>
                <input
                  type="number"
                  required
                  value={balance}
                  onChange={e => setBalance(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-gray-900"
                  placeholder="0.00"
                />
              </div>

              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="block font-medium text-gray-900">Include in Total Balance</span>
                    <span className="block text-xs text-gray-500 mt-1">If unchecked, this account won't show in the dashboard's main number.</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={includeInTotal} 
                    onChange={e => setIncludeInTotal(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900 ml-4"
                  />
                </label>
              </div>

              <div className="pt-4 flex space-x-3">
                {editingId && (
                  <button 
                    type="button"
                    onClick={() => handleDelete(editingId)}
                    className="px-4 py-4 bg-red-50 text-red-600 rounded-xl font-medium active:scale-[0.98] transition-transform"
                  >
                    <Trash2 size={20} />
                  </button>
                )}
                <button 
                  type="submit" 
                  className="flex-1 py-4 bg-gray-900 text-white rounded-xl font-medium text-lg active:scale-[0.98] transition-transform"
                >
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
