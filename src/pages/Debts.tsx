import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { triggerSync } from '../sync/syncEngine';

export default function Debts() {
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  
  // Calculate IOUs from shared transactions
  const sharedTxns = transactions.filter(t => t.isShared && t.personalAmount !== undefined);
  
  const pendingTxns = sharedTxns.filter(t => !t.isSettled);
  const settledTxns = sharedTxns.filter(t => t.isSettled);
  
  // Basic implementation: total owed to me = (total amount - my share)
  const totalOwedToMe = pendingTxns.reduce((sum, t) => sum + (t.amount - (t.personalAmount || 0)), 0);

  const handleSettle = async (txn: typeof pendingTxns[0]) => {
    const account = await db.accounts.get(txn.accountId);
    if (account && txn.personalAmount !== undefined) {
      // When settled: refund the other person's share back to the account
      const othersShare = txn.amount - txn.personalAmount;
      await db.accounts.update(txn.accountId, { 
        balance: account.balance + othersShare,
        updatedAt: Date.now()
      });
    }
    await db.transactions.update(txn.id, { 
      isSettled: true,
      updatedAt: Date.now() 
    });
    triggerSync();
  };

  const handleUnsettle = async (txn: typeof settledTxns[0]) => {
    const account = await db.accounts.get(txn.accountId);
    if (account && txn.personalAmount !== undefined) {
      // When unsettled: deduct the other person's share again
      const othersShare = txn.amount - txn.personalAmount;
      await db.accounts.update(txn.accountId, { 
        balance: account.balance - othersShare,
        updatedAt: Date.now()
      });
    }
    await db.transactions.update(txn.id, { 
      isSettled: false,
      updatedAt: Date.now() 
    });
    triggerSync();
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-medium mb-6 text-foreground">IOUs</h2>
      
      <div className="bg-card rounded-2xl p-6 border border-border shadow-sm mb-6">
        <p className="text-sm text-muted-foreground font-medium mb-1">Total owed to you</p>
        <p className="text-4xl font-light text-green-500">
          <span className="text-2xl mr-1">LKR</span>
          {totalOwedToMe.toLocaleString()}
        </p>
      </div>

      <h3 className="text-lg font-medium text-foreground mb-4">Pending Splits</h3>
      <div className="space-y-3 mb-8">
        {pendingTxns.map(txn => {
          const owedAmount = txn.amount - (txn.personalAmount || 0);
          return (
            <div key={txn.id} className="flex flex-col p-4 bg-card border border-border rounded-xl shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <p className="font-medium text-foreground">{txn.notes || 'Shared Expense'}</p>
                  <p className="text-xs text-muted-foreground">{new Date(txn.date).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-green-500">LKR {owedAmount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">of {txn.amount}</p>
                </div>
              </div>
              <button
                onClick={() => handleSettle(txn)}
                className="w-full py-2 bg-green-500/10 text-green-500 rounded-lg text-sm font-medium hover:bg-green-500/20 transition-colors"
              >
                Mark as Settled
              </button>
            </div>
          );
        })}
        {pendingTxns.length === 0 && (
          <p className="text-muted-foreground text-center py-6 border border-dashed border-border rounded-xl">No pending IOUs.</p>
        )}
      </div>

      {settledTxns.length > 0 && (
        <>
          <h3 className="text-lg font-medium text-foreground mb-4">Settled Splits</h3>
          <div className="space-y-3 opacity-70">
            {settledTxns.map(txn => {
              const owedAmount = txn.amount - (txn.personalAmount || 0);
              return (
                <div key={txn.id} className="flex justify-between items-center p-4 bg-card border border-border rounded-xl shadow-sm">
                  <div>
                    <p className="font-medium text-foreground line-through">{txn.notes || 'Shared Expense'}</p>
                    <p className="text-xs text-muted-foreground">{new Date(txn.date).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-medium text-muted-foreground line-through">LKR {owedAmount.toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => handleUnsettle(txn)}
                      className="p-2 hover:bg-muted rounded-lg text-xs"
                      title="Undo settle"
                    >
                      Undo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

