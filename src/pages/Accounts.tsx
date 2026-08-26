import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

export default function Accounts() {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-medium mb-6 text-gray-900">Accounts</h2>
      
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm mb-8">
        <p className="text-sm text-gray-500 font-medium mb-1">Net Worth</p>
        <p className="text-4xl font-light text-gray-900">
          <span className="text-2xl mr-1">LKR</span>
          {totalBalance.toLocaleString()}
        </p>
      </div>

      <div className="space-y-3">
        {accounts.map(acc => (
          <div key={acc.id} className="p-4 bg-white border border-gray-100 rounded-xl shadow-sm flex justify-between items-center">
            <div className="flex items-center">
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-lg mr-3 border border-gray-100">
                {acc.type === 'cash' ? '💵' : acc.type === 'bank' ? '🏦' : '💳'}
              </div>
              <div>
                <p className="font-medium text-gray-900">{acc.name}</p>
                <p className="text-xs text-gray-500 capitalize">{acc.type}</p>
              </div>
            </div>
            <div className="font-medium text-gray-900">
              LKR {acc.balance.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

