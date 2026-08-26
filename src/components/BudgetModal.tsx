import { useState } from 'react';
import { X } from 'lucide-react';
import { db } from '../db/db';
import { useUIStore } from '../store/uiStore';
import { differenceInDays } from 'date-fns';

export default function BudgetModal() {
  const { isBudgetModalOpen, setBudgetModalOpen } = useUIStore();
  
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  
  // Format dates for input type="date"
  const todayStr = new Date().toISOString().split('T')[0];
  const [startDateStr, setStartDateStr] = useState(todayStr);
  
  const defaultEnd = new Date();
  defaultEnd.setDate(defaultEnd.getDate() + 30);
  const [endDateStr, setEndDateStr] = useState(defaultEnd.toISOString().split('T')[0]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || isNaN(Number(amount))) return;
    if (!startDateStr || !endDateStr) return;

    // Parse start date as local midnight
    const [sy, sm, sd] = startDateStr.split('-').map(Number);
    const parsedStart = new Date(sy, sm - 1, sd).getTime();
    // If the selected start date is today, use right now so existing
    // transactions from earlier today are NOT counted towards this budget.
    const todayLocalMidnight = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
    const start = parsedStart === todayLocalMidnight ? Date.now() : parsedStart;

    // End of the selected end-date day (local midnight + 1 day - 1ms)
    const [ey, em, ed] = endDateStr.split('-').map(Number);
    const endDateObj = new Date(ey, em - 1, ed, 23, 59, 59, 999);
    const end = endDateObj.getTime();

    if (end < start) {
      alert("End date must be after start date.");
      return;
    }

    const numAmount = Number(amount);
    const days = differenceInDays(end, start) + 1;

    try {
      // Create new budget
      await db.budgets.add({
        id: `bud-${Date.now()}`,
        name,
        amount: numAmount,
        period: 'days', // fallback
        periodLength: days,
        startDate: start,
        endDate: end,
        status: 'active'
      });

      // Reset & close
      setName('');
      setAmount('');
      setBudgetModalOpen(false);
    } catch (error) {
      console.error("Failed to save budget", error);
    }
  };

  if (!isBudgetModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col animate-in slide-in-from-bottom-full duration-300">
        
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100">
          <h2 className="text-xl font-medium text-gray-900">New Budget Period</h2>
          <button onClick={() => setBudgetModalOpen(false)} className="p-2 bg-gray-100 rounded-full text-gray-500 active:scale-95">
            <X size={20} />
          </button>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto">
          <form id="budget-form" onSubmit={handleSubmit} className="p-6 space-y-6">
            
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Budget Name</label>
              <input
                type="text"
                autoFocus
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-gray-900"
                placeholder="e.g. August Groceries"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Amount</label>
              <div className="flex items-center text-5xl font-light">
                <span className="text-2xl text-gray-400 mr-2">LKR</span>
                <input
                  type="number"
                  inputMode="decimal"
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full bg-transparent outline-none placeholder:text-gray-300"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Start Date</label>
                <input
                  type="date"
                  required
                  value={startDateStr}
                  onChange={e => setStartDateStr(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-gray-900"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">End Date</label>
                <input
                  type="date"
                  required
                  value={endDateStr}
                  onChange={e => setEndDateStr(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-gray-900"
                />
              </div>
            </div>
            
          </form>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 bg-white">
          <button 
            type="submit" 
            form="budget-form"
            className="w-full py-4 bg-gray-900 text-white rounded-xl font-medium text-lg active:scale-[0.98] transition-transform"
          >
            Start Budget
          </button>
        </div>

      </div>
    </div>
  );
}

