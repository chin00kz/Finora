import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { differenceInDays } from 'date-fns';

export default function Dashboard() {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const budgets = useLiveQuery(() => db.budgets.toArray()) || [];
  const activeBudget = budgets[0]; // Assuming just one active budget for MVP

  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];

  // Calculate total balance
  const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);

  // Budget calculations
  let spentThisPeriod = 0;
  let remainingBudget = 0;
  let onTrackStatus = '🟢';
  let progressPercentage = 0;
  let daysLeft = 0;

  if (activeBudget) {
    const today = new Date().getTime();
    
    // Calculate spent
    const periodTransactions = transactions.filter(t => 
      t.type === 'expense' && 
      t.date >= activeBudget.startDate && 
      t.date <= activeBudget.endDate
    );
    
    spentThisPeriod = periodTransactions.reduce((sum, t) => {
      // If it's a shared expense, only count personal amount towards budget
      const amountToCount = t.isShared && t.personalAmount ? t.personalAmount : t.amount;
      return sum + amountToCount;
    }, 0);

    remainingBudget = activeBudget.amount - spentThisPeriod;
    progressPercentage = Math.min(100, Math.max(0, (spentThisPeriod / activeBudget.amount) * 100));

    // Calculate pace
    const totalDays = activeBudget.periodLength;
    const daysElapsed = Math.max(1, differenceInDays(today, activeBudget.startDate) + 1); // +1 to include today
    daysLeft = Math.max(0, differenceInDays(activeBudget.endDate, today));
    
    const expectedSpendRate = activeBudget.amount / totalDays;
    const actualSpendRate = spentThisPeriod / daysElapsed;

    if (actualSpendRate <= expectedSpendRate) {
      onTrackStatus = '🟢';
    } else if (actualSpendRate <= expectedSpendRate * 1.2) {
      onTrackStatus = '🟡';
    } else {
      onTrackStatus = '🔴';
    }
  }

  // Recent transactions preview
  const recentTransactions = [...transactions]
    .sort((a, b) => b.date - a.date)
    .slice(0, 5);

  return (
    <div className="p-6">
      <header className="mb-8 mt-4">
        <h1 className="text-5xl font-light tracking-tight text-gray-900 mb-1">
          <span className="text-2xl align-top mr-1">LKR</span>
          {totalBalance.toLocaleString()}
        </h1>
        <p className="text-gray-500 font-medium">Available Balance</p>
      </header>

      {activeBudget && (
        <section className="bg-white rounded-2xl p-5 mb-8 border border-gray-100 shadow-sm">
          <div className="flex justify-between items-end mb-4">
            <div>
              <p className="text-sm text-gray-500 font-medium mb-1">
                {activeBudget.name}
              </p>
              <p className="text-3xl font-medium text-gray-900">
                <span className="text-sm mr-1">LKR</span>
                {remainingBudget.toLocaleString()}
                <span className="text-sm text-gray-400 font-normal ml-2">left</span>
              </p>
            </div>
            <div className="text-right pb-1">
              <div className="bg-gray-50 px-3 py-1 rounded-full inline-flex items-center">
                <span className="text-sm font-medium mr-2">Pace</span>
                <span className="text-lg">{onTrackStatus}</span>
              </div>
            </div>
          </div>
          
          <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden mb-3">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${onTrackStatus === '🔴' ? 'bg-red-500' : onTrackStatus === '🟡' ? 'bg-yellow-500' : 'bg-gray-900'}`}
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
          
          <div className="flex justify-between text-sm font-medium text-gray-500">
            <span>Spent: LKR {spentThisPeriod.toLocaleString()}</span>
            <span>{daysLeft} days left</span>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {recentTransactions.map(txn => (
            <div key={txn.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl shadow-sm">
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-lg mr-3">
                  {txn.type === 'expense' ? '💸' : txn.type === 'income' ? '💰' : '🔄'}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{txn.notes || (txn.type === 'expense' ? 'Expense' : txn.type === 'income' ? 'Income' : 'Transfer')}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(txn.date).toLocaleDateString()} {txn.isShared && '• Split'}
                  </p>
                </div>
              </div>
              <div className={`font-medium ${txn.type === 'expense' ? 'text-gray-900' : txn.type === 'income' ? 'text-green-600' : 'text-gray-500'}`}>
                {txn.type === 'expense' ? '-' : txn.type === 'income' ? '+' : ''}LKR {txn.amount.toLocaleString()}
              </div>
            </div>
          ))}
          {recentTransactions.length === 0 && (
            <p className="text-gray-500 text-center py-4">No recent activity.</p>
          )}
        </div>
      </section>
    </div>
  );
}
