import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

export default function Debts() {
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  
  // Calculate IOUs from shared transactions
  const sharedTxns = transactions.filter(t => t.isShared && t.personalAmount !== undefined);
  
  // Basic implementation: total owed to me = (total amount - my share)
  const totalOwedToMe = sharedTxns.reduce((sum, t) => sum + (t.amount - (t.personalAmount || 0)), 0);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-medium mb-6 text-gray-900">IOUs</h2>
      
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm mb-6">
        <p className="text-sm text-gray-500 font-medium mb-1">Total owed to you</p>
        <p className="text-4xl font-light text-green-600">
          <span className="text-2xl mr-1">LKR</span>
          {totalOwedToMe.toLocaleString()}
        </p>
      </div>

      <h3 className="text-lg font-medium text-gray-900 mb-4">Pending Splits</h3>
      <div className="space-y-3">
        {sharedTxns.map(txn => {
          const owedAmount = txn.amount - (txn.personalAmount || 0);
          return (
            <div key={txn.id} className="flex justify-between items-center p-4 bg-white border border-gray-100 rounded-xl shadow-sm">
              <div>
                <p className="font-medium text-gray-900">{txn.notes || 'Shared Expense'}</p>
                <p className="text-xs text-gray-500">{new Date(txn.date).toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-green-600">LKR {owedAmount.toLocaleString()}</p>
                <p className="text-xs text-gray-500">of {txn.amount}</p>
              </div>
            </div>
          );
        })}
        {sharedTxns.length === 0 && (
          <p className="text-gray-500 text-center py-6 border border-dashed border-gray-200 rounded-xl">No pending IOUs.</p>
        )}
      </div>
    </div>
  );
}

