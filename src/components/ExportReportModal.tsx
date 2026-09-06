import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { X, Download, Printer, FileSpreadsheet } from 'lucide-react';
import { exportPeriodCSV, printPeriodReport } from '../utils/reportExporter';
import { subDays, startOfMonth, endOfMonth, format } from 'date-fns';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPeriod?: string; // 'current' | budgetId | 'this_month' | '30_days'
}

export default function ExportReportModal({ isOpen, onClose, defaultPeriod = 'current' }: ExportReportModalProps) {
  const budgets = useLiveQuery(() => db.budgets.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const tags = useLiveQuery(() => db.tags.toArray()) || [];

  const activeBudget = budgets.find(b => b.status === 'active');
  const pastBudgets = budgets.filter(b => b.status === 'ended');

  const [selectedPeriod, setSelectedPeriod] = useState<string>(defaultPeriod);
  const [formatType, setFormatType] = useState<'csv' | 'pdf'>('csv');

  // Early-return after all hooks. Because we return null when closed,
  // React will remount the component each time it opens, automatically
  // resetting selectedPeriod to the current defaultPeriod.
  if (!isOpen) return null;

  const handleExport = () => {
    let periodTransactions = [...transactions];
    let periodLabel = 'All Transactions';
    let dateRange = 'All Time';
    let budgetAmount: number | undefined;

    const now = new Date();

    if (selectedPeriod === 'current' && activeBudget) {
      periodLabel = activeBudget.name;
      dateRange = `${format(new Date(activeBudget.startDate), 'MMM dd, yyyy')} - ${format(new Date(activeBudget.endDate), 'MMM dd, yyyy')}`;
      budgetAmount = activeBudget.amount;
      periodTransactions = transactions.filter(
        t => t.date >= activeBudget.startDate && t.date <= activeBudget.endDate
      );
    } else if (selectedPeriod.startsWith('budget_')) {
      const bId = selectedPeriod.replace('budget_', '');
      const b = budgets.find(x => x.id === bId);
      if (b) {
        periodLabel = b.name;
        dateRange = `${format(new Date(b.startDate), 'MMM dd, yyyy')} - ${format(new Date(b.endDate), 'MMM dd, yyyy')}`;
        budgetAmount = b.amount;
        periodTransactions = transactions.filter(
          t => t.date >= b.startDate && t.date <= b.endDate
        );
      }
    } else if (selectedPeriod === 'this_month') {
      const start = startOfMonth(now).getTime();
      const end = endOfMonth(now).getTime();
      periodLabel = format(now, 'MMMM yyyy');
      dateRange = `${format(start, 'MMM dd')} - ${format(end, 'MMM dd, yyyy')}`;
      periodTransactions = transactions.filter(t => t.date >= start && t.date <= end);
    } else if (selectedPeriod === '30_days') {
      const start = subDays(now, 30).getTime();
      periodLabel = 'Last 30 Days';
      dateRange = `${format(start, 'MMM dd')} - ${format(now, 'MMM dd, yyyy')}`;
      periodTransactions = transactions.filter(t => t.date >= start);
    }

    // Sort chronologically (oldest to newest for export)
    periodTransactions.sort((a, b) => a.date - b.date);

    if (formatType === 'csv') {
      exportPeriodCSV({
        transactions: periodTransactions,
        categories,
        accounts,
        tags,
        periodName: periodLabel,
      });
      onClose();
    } else {
      // Prepare printable data
      const catMap = new Map(categories.map(c => [c.id, c]));
      const accMap = new Map(accounts.map(a => [a.id, a.name]));

      const expenses = periodTransactions.filter(t => t.type === 'expense');
      const incomes = periodTransactions.filter(t => t.type === 'income');

      const totalExpense = expenses.reduce((sum, t) => sum + (t.personalAmount ?? t.amount), 0);
      const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);

      // Category breakdown
      const catSpending = new Map<string, number>();
      for (const t of expenses) {
        const cId = t.categoryId || 'uncat';
        catSpending.set(cId, (catSpending.get(cId) || 0) + (t.personalAmount ?? t.amount));
      }

      const categoryBreakdown = Array.from(catSpending.entries()).map(([cId, amount]) => {
        const cat = catMap.get(cId);
        return {
          name: cat?.name || 'Uncategorized',
          amount,
          percent: totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0,
          color: cat?.color || '#64748b',
        };
      }).sort((a, b) => b.amount - a.amount);

      const printableTxns = [...periodTransactions]
        .sort((a, b) => b.date - a.date)
        .map(t => ({
          date: t.date,
          type: t.type,
          categoryName: t.categoryId ? catMap.get(t.categoryId)?.name || 'Uncategorized' : 'None',
          accountName: accMap.get(t.accountId) || 'Unknown',
          amount: t.amount,
          notes: t.notes,
        }));

      printPeriodReport({
        title: 'Finora Financial Report',
        periodLabel,
        dateRange,
        currency: 'LKR',
        totalExpense,
        totalIncome,
        budgetAmount,
        remainingBudget: budgetAmount !== undefined ? budgetAmount - totalExpense : undefined,
        isOverspent: budgetAmount !== undefined ? totalExpense > budgetAmount : false,
        categoryBreakdown,
        transactions: printableTxns,
      });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-medium text-foreground">Export Report</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Download or print transactions and budget summary</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-5">
          {/* Period Selection */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Period
            </label>
            <select
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value)}
              className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
            >
              {activeBudget && (
                <option value="current">Current Budget: {activeBudget.name}</option>
              )}
              <option value="this_month">This Month</option>
              <option value="30_days">Last 30 Days</option>
              {pastBudgets.map(b => (
                <option key={b.id} value={`budget_${b.id}`}>
                  Past Budget: {b.name}
                </option>
              ))}
              <option value="all">All Transactions (Full History)</option>
            </select>
          </div>

          {/* Format Selection */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormatType('csv')}
                className={`p-4 rounded-xl border text-left flex flex-col items-start gap-2 transition-all ${
                  formatType === 'csv'
                    ? 'border-foreground bg-muted text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-border/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={18} className={formatType === 'csv' ? 'text-foreground' : 'text-muted-foreground'} />
                  <span className="text-sm font-medium">CSV</span>
                </div>
                <span className="text-[11px] text-muted-foreground">Raw data for Excel, Google Sheets, or CSV analysis</span>
              </button>

              <button
                type="button"
                onClick={() => setFormatType('pdf')}
                className={`p-4 rounded-xl border text-left flex flex-col items-start gap-2 transition-all ${
                  formatType === 'pdf'
                    ? 'border-foreground bg-muted text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-border/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Printer size={18} className={formatType === 'pdf' ? 'text-foreground' : 'text-muted-foreground'} />
                  <span className="text-sm font-medium">PDF / Print</span>
                </div>
                <span className="text-[11px] text-muted-foreground">Clean printable report with category stats & totals</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 border border-border bg-background text-muted-foreground rounded-xl text-sm font-medium hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex-1 py-2.5 px-4 bg-accent text-accent-foreground rounded-xl text-sm font-medium flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-transform"
          >
            {formatType === 'csv' ? <Download size={16} /> : <Printer size={16} />}
            <span>{formatType === 'csv' ? 'Download CSV' : 'Generate PDF'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

