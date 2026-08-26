import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { format } from 'date-fns';

export default function Activity() {
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];

  const getCategory = (id?: string) => categories.find(c => c.id === id);

  // Group by day
  const grouped = [...transactions].sort((a, b) => b.date - a.date).reduce((acc, txn) => {
    const day = format(new Date(txn.date), 'MMM d, yyyy');
    if (!acc[day]) acc[day] = [];
    acc[day].push(txn);
    return acc;
  }, {} as Record<string, typeof transactions>);

  return (
    <div className="p-6 pb-24">
      <h2 className="text-2xl font-medium mb-6 text-gray-900">Activity</h2>
      
      <div className="space-y-6">
        {Object.entries(grouped).map(([day, txns]) => (
          <div key={day}>
            <h3 className="text-sm font-medium text-gray-500 mb-3">{day}</h3>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {txns.map((txn, i) => {
                const category = getCategory(txn.categoryId);
                return (
                  <div key={txn.id} className={`p-4 flex items-center justify-between ${i !== txns.length - 1 ? 'border-b border-gray-100' : ''}`}>
                    <div className="flex items-center">
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center text-lg mr-3"
                        style={{ backgroundColor: category?.color ? `${category.color}20` : '#f3f4f6', color: category?.color || '#374151' }}
                      >
                        {txn.type === 'expense' ? '💸' : txn.type === 'income' ? '💰' : '🔄'}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{txn.notes || category?.name || (txn.type === 'transfer' ? 'Transfer' : 'Transaction')}</p>
                        {txn.isShared && <p className="text-xs text-blue-600 font-medium">Split • Your share: {txn.personalAmount}</p>}
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
          <p className="text-gray-500 text-center py-10">No activity yet.</p>
        )}
      </div>
    </div>
  );
}
