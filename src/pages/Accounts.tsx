import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { AccountType } from '../db/db';
import { Plus, X, Trash2 } from 'lucide-react';

const ACCOUNT_TYPES: { id: AccountType; label: string; icon: string }[] = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'wallet', label: 'Wallet', icon: '👛' },
  { id: 'bank', label: 'Bank', icon: '🏦' },
  { id: 'card', label: 'Card', icon: '💳' },
  { id: 'savings', label: 'Savings', icon: '🐷' },
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
        <h2 className="text-2xl font-medium text-foreground">Accounts</h2>
        <button 
          onClick={() => openModal()}
          className="bg-muted text-foreground px-3 py-2 rounded-xl text-sm font-medium flex items-center active:scale-95 transition-transform"
        >
          <Plus size={16} className="mr-1" /> Add
        </button>
      </div>
      
      <div className="bg-card rounded-2xl p-6 border border-border shadow-sm mb-8">
        <p className="text-sm text-muted-foreground font-medium mb-1">Net Worth</p>
        <p className="text-4xl font-light text-foreground">
          <span className="text-2xl mr-1">LKR</span>
          {totalBalance.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground mt-2">Only includes accounts marked "Include in Total"</p>
      </div>

      <div className="space-y-3">
        {accounts.map(acc => (
          <div key={acc.id} onClick={() => openModal(acc)} className={`p-4 bg-card border rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-muted/50 transition-colors ${!acc.includeInTotal ? 'border-dashed border-border opacity-70' : 'border-border'}`}>
            <div className="flex items-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg mr-3 border border-border">
                {getIcon(acc.type)}
              </div>
              <div>
                <p className="font-medium text-foreground flex items-center">
                  {acc.name} 
                  {!acc.includeInTotal && <span className="ml-2 text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-medium uppercase tracking-wider">Excluded</span>}
                </p>
                <p className="text-xs text-muted-foreground capitalize">{acc.type}</p>
              </div>
            </div>
            <div className="font-medium text-foreground">
              LKR {acc.balance.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col animate-in slide-in-from-bottom-full duration-300">
            <div className="flex justify-between items-center p-5 border-b border-border">
              <h2 className="text-xl font-medium text-foreground">{editingId ? 'Edit Account' : 'New Account'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-muted rounded-full text-muted-foreground active:scale-95">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                  placeholder="e.g. HNB Savings"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {ACCOUNT_TYPES.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-colors ${
                        type === t.id ? 'border-foreground bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground'
                      }`}
                    >
                      <span className="text-xl mb-1">{t.icon}</span>
                      <span className="text-xs font-medium">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Current Balance (LKR)</label>
                <input
                  type="number"
                  required
                  value={balance}
                  onChange={e => setBalance(e.target.value)}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                  placeholder="0.00"
                />
              </div>

              <div className="bg-muted/50 p-4 rounded-xl border border-border">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="block font-medium text-foreground">Include in Total Balance</span>
                    <span className="block text-xs text-muted-foreground mt-1">If unchecked, this account won't show in the dashboard's main number.</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={includeInTotal} 
                    onChange={e => setIncludeInTotal(e.target.checked)}
                    className="w-5 h-5 rounded border-border text-accent focus:ring-accent ml-4"
                  />
                </label>
              </div>

              <div className="pt-4 flex space-x-3">
                {editingId && (
                  <button 
                    type="button"
                    onClick={() => handleDelete(editingId)}
                    className="px-4 py-4 bg-red-500/10 text-red-500 rounded-xl font-medium active:scale-[0.98] transition-transform"
                  >
                    <Trash2 size={20} />
                  </button>
                )}
                <button 
                  type="submit" 
                  className="flex-1 py-4 bg-accent text-accent-foreground rounded-xl font-medium text-lg active:scale-[0.98] transition-transform"
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
