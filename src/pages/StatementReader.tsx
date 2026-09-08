import { useState, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { StatementTransaction } from '../db/db';
import { extractLinesFromPdf, parseCombankStatement } from '../utils/statementParser';
import MaskedAmount from '../components/MaskedAmount';
import {
  FileText,
  Upload,
  AlertCircle,
  CheckCircle2,
  Trash2,
  CreditCard,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Search,
  RefreshCw,
  Clock,
  Award,
} from 'lucide-react';

export default function StatementReader() {
  const cards = useLiveQuery(() => db.statementCards.toArray()) || [];
  const statements = useLiveQuery(() => db.parsedStatements.orderBy('billingDate').reverse().toArray()) || [];

  const [selectedCardId, setSelectedCardId] = useState<string>('all');
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null);

  // Upload modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadCardId, setUploadCardId] = useState<string>('');
  const [newCardLabel, setNewCardLabel] = useState('');
  const [isCreatingCard, setIsCreatingCard] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Search filter inside statement
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filtered statements for active card selector
  const availableStatements = useMemo(() => {
    if (selectedCardId === 'all') return statements;
    return statements.filter(s => s.cardId === selectedCardId);
  }, [statements, selectedCardId]);

  // Active statement object
  const activeStatement = useMemo(() => {
    if (selectedStatementId) {
      const found = statements.find(s => s.id === selectedStatementId);
      if (found) return found;
    }
    return availableStatements[0] || null;
  }, [selectedStatementId, availableStatements, statements]);

  // Group transactions by category (excluding payments)
  const categoryGroups = useMemo(() => {
    if (!activeStatement) return [];
    const groups: Record<string, { category: string; total: number; txns: StatementTransaction[] }> = {};

    for (const txn of activeStatement.transactions) {
      if (txn.isCredit) continue; // Payments & credits are shown in their own section
      const cat = txn.category || 'Other Expenses';
      if (!groups[cat]) {
        groups[cat] = { category: cat, total: 0, txns: [] };
      }
      groups[cat].total += txn.amount;
      groups[cat].txns.push(txn);
    }

    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [activeStatement]);

  // Filtered transactions for search
  const filteredTxns = useMemo(() => {
    if (!activeStatement || !searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase();
    return activeStatement.transactions.filter(t =>
      t.description.toLowerCase().includes(query) ||
      t.amount.toString().includes(query) ||
      (t.category && t.category.toLowerCase().includes(query))
    );
  }, [activeStatement, searchQuery]);

  // Payment transactions
  const paymentsList = useMemo(() => {
    if (!activeStatement) return [];
    return activeStatement.transactions.filter(t => t.isCredit);
  }, [activeStatement]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleFileUpload = async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setParseError('Please select a valid PDF file.');
      return;
    }

    setIsParsing(true);
    setParseError(null);

    try {
      // 1. Client-side extraction via pdfjs-dist
      const lines = await extractLinesFromPdf(file);
      if (lines.length === 0) {
        throw new Error('No readable text found in PDF. Make sure it is not a scanned image.');
      }

      // 2. Initial parse to inspect layout and metadata
      const initialParsed = parseCombankStatement(lines, 'temp', 'temp');

      // 3. Resolve target card (auto-detect if user did not specify)
      let targetCardId = uploadCardId;
      let targetCardLabel = '';
      const last4 = initialParsed.cardNumberMasked ? initialParsed.cardNumberMasked.slice(-4) : undefined;

      if (isCreatingCard && newCardLabel.trim()) {
        targetCardId = `scard-${Date.now()}`;
        targetCardLabel = newCardLabel.trim();
        await db.statementCards.add({
          id: targetCardId,
          label: targetCardLabel,
          last4,
          cardType: initialParsed.cardType,
          bankName: 'Commercial Bank of Ceylon',
          updatedAt: Date.now(),
        });
      } else if (targetCardId && targetCardId !== '__new__') {
        const found = cards.find(c => c.id === targetCardId);
        targetCardLabel = found ? found.label : 'Credit Card';
      } else {
        // Auto-detect matching card from database or auto-create one
        const existingCard = last4 ? cards.find(c => c.last4 === last4) : null;
        if (existingCard) {
          targetCardId = existingCard.id;
          targetCardLabel = existingCard.label;
        } else {
          targetCardId = `scard-${Date.now()}`;
          const typeName = initialParsed.cardType || 'Credit Card';
          targetCardLabel = `Combank ${typeName}${last4 ? ` - ${last4}` : ''}`;
          await db.statementCards.add({
            id: targetCardId,
            label: targetCardLabel,
            last4,
            cardType: initialParsed.cardType,
            bankName: 'Commercial Bank of Ceylon',
            updatedAt: Date.now(),
          });
        }
      }

      // 4. Update statement with resolved card
      initialParsed.cardId = targetCardId;
      initialParsed.cardLabel = targetCardLabel;
      initialParsed.id = `stmt-${targetCardId}-${initialParsed.statementPeriod}-${Date.now()}`;

      // 5. Save to Dexie
      await db.parsedStatements.add(initialParsed);

      // Select newly parsed statement
      setSelectedCardId(targetCardId);
      setSelectedStatementId(initialParsed.id);
      setIsUploadModalOpen(false);
      setIsCreatingCard(false);
      setNewCardLabel('');
      setUploadCardId('');
    } catch (err: any) {
      console.error('PDF Statement parsing failed:', err);
      setParseError(err.message || 'Failed to parse PDF statement.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleDeleteStatement = async (statementId: string) => {
    if (confirm('Are you sure you want to delete this parsed statement?')) {
      await db.parsedStatements.delete(statementId);
      if (selectedStatementId === statementId) {
        setSelectedStatementId(null);
      }
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* ── Page Header & Controls ──────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Statement Reader</h1>
            <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent text-[11px] font-semibold flex items-center gap-1">
              <ShieldCheck size={13} />
              100% Client-Side
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Private, offline-ready PDF statement interpreter for Commercial Bank credit cards.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Statement Switcher */}
          {availableStatements.length > 0 && (
            <select
              value={activeStatement?.id || ''}
              onChange={(e) => setSelectedStatementId(e.target.value)}
              className="bg-card border border-border rounded-xl px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {availableStatements.map(s => (
                <option key={s.id} value={s.id}>
                  {s.cardLabel} — {s.statementPeriod} ({s.billingDate})
                </option>
              ))}
            </select>
          )}

          {/* Upload Button */}
          <button
            onClick={() => {
              setParseError(null);
              setIsUploadModalOpen(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-foreground text-background rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Upload size={14} />
            <span>Upload Statement</span>
          </button>
        </div>
      </div>

      {/* ── No Statements Placeholder ───────────────────────────────────────── */}
      {!activeStatement && (
        <div className="bg-card rounded-2xl border border-border border-dashed p-10 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto text-muted-foreground">
            <FileText size={28} />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-base font-semibold text-foreground">No credit card statements uploaded yet</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload your monthly Commercial Bank credit card PDF statement to instantly see your total outstanding,
              installment tenures, and an itemized breakdown of what you spent on.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => {
                setParseError(null);
                setIsUploadModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-foreground text-background rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
            >
              <Upload size={15} />
              <span>Upload Combank PDF Statement</span>
            </button>
          </div>
          <div className="pt-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span>Parsing is performed entirely in your browser. Your financial documents never leave your device.</span>
          </div>
        </div>
      )}

      {/* ── Active Statement View ───────────────────────────────────────────── */}
      {activeStatement && (
        <div className="space-y-6">
          {/* Header Summary Card */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-border gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent/10 rounded-xl text-accent">
                  <CreditCard size={20} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">{activeStatement.cardLabel}</h2>
                    {activeStatement.cardNumberMasked && (
                      <span className="font-mono text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-md border border-border/50">
                        {activeStatement.cardNumberMasked}
                      </span>
                    )}
                    {activeStatement.cardType && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-accent/15 text-accent font-medium">
                        {activeStatement.cardType}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {activeStatement.cardholderName && (
                      <span className="font-medium text-foreground mr-1.5">{activeStatement.cardholderName} ·</span>
                    )}
                    Statement Period: <span className="font-medium text-foreground">{activeStatement.statementPeriod}</span> · Billing Date: {activeStatement.billingDate}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeStatement.rewardsPoints !== undefined && (
                  <span className="text-[11px] px-2.5 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium rounded-lg flex items-center gap-1.5">
                    <Award size={13} />
                    {activeStatement.rewardsPoints.toLocaleString()} Max Rewards
                  </span>
                )}
                <span className="text-[11px] px-2.5 py-1 bg-muted rounded-lg text-muted-foreground">
                  APR: {activeStatement.annualInterestRate ? `${activeStatement.annualInterestRate}% p.a.` : 'N/A'}
                  {activeStatement.monthlyInterestRate ? ` (${activeStatement.monthlyInterestRate}% / mo)` : ''}
                </span>
                <button
                  onClick={() => handleDeleteStatement(activeStatement.id)}
                  className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                  title="Delete this parsed statement"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {/* 4-Stat Metric Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Total Outstanding */}
              <div className="p-3.5 bg-muted/40 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Outstanding</span>
                <p className="text-lg sm:text-xl font-bold text-foreground">
                  LKR <MaskedAmount amount={activeStatement.totalOutstanding} />
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Due by {activeStatement.dueDate}
                </p>
              </div>

              {/* Minimum Payment Due */}
              <div className="p-3.5 bg-muted/40 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Minimum Payment Due</span>
                <p className="text-lg sm:text-xl font-bold text-foreground">
                  LKR <MaskedAmount amount={activeStatement.minimumPaymentDue} />
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Min to avoid late charge
                </p>
              </div>

              {/* Payment Due Date & Countdown */}
              <div className="p-3.5 bg-muted/40 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Payment Due Date</span>
                <div className="flex items-center gap-2">
                  <p className="text-sm sm:text-base font-bold text-foreground">{activeStatement.dueDate}</p>
                </div>
                {activeStatement.daysUntilDue !== undefined ? (
                  <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-md ${
                    activeStatement.daysUntilDue < 0
                      ? 'bg-red-500/10 text-red-500'
                      : activeStatement.daysUntilDue <= 3
                      ? 'bg-amber-500/10 text-amber-500'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {activeStatement.daysUntilDue < 0
                      ? `${Math.abs(activeStatement.daysUntilDue)}d overdue`
                      : activeStatement.daysUntilDue === 0
                      ? 'Due today'
                      : `${activeStatement.daysUntilDue} days remaining`}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Standard grace cycle</span>
                )}
              </div>

              {/* Credit Limit & Utilization */}
              <div className="p-3.5 bg-muted/40 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Credit Limit</span>
                <p className="text-lg sm:text-xl font-bold text-foreground">
                  LKR <MaskedAmount amount={activeStatement.creditLimit} />
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Available: LKR <MaskedAmount amount={activeStatement.availableCredit || 0} />
                </p>
              </div>
            </div>

            {/* Reconciliation Strip (Statement's printed math) */}
            <div className="pt-2 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground font-mono">
                <span>Opening (LKR <MaskedAmount amount={activeStatement.openingBalance} />)</span>
                <span>+</span>
                <span className="text-foreground">Purchases (LKR <MaskedAmount amount={activeStatement.totalPurchases} />)</span>
                <span>−</span>
                <span className="text-emerald-500">Payments (LKR <MaskedAmount amount={activeStatement.totalPayments} />)</span>
                <span>=</span>
                <span className="text-foreground font-bold">Closing (LKR <MaskedAmount amount={activeStatement.closingBalance} />)</span>
              </div>
              <div>
                {activeStatement.isReconciled ? (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 size={13} />
                    Balanced Statement
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 font-medium">
                    <AlertCircle size={13} />
                    Discrepancy (Fees / Offsets)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Installment Plans Section ────────────────────────────────────────── */}
          {activeStatement.installmentPlans.length > 0 && (
            <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={18} className="text-accent" />
                  <h3 className="font-semibold text-foreground text-sm">Active 0% Installment Plans</h3>
                </div>
                <span className="text-xs text-muted-foreground font-medium">
                  {activeStatement.installmentPlans.length} plan{activeStatement.installmentPlans.length > 1 ? 's' : ''} detected
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {activeStatement.installmentPlans.map(plan => {
                  const pct = Math.min(100, Math.round((plan.currentInstallment / plan.totalInstallments) * 100));
                  return (
                    <div key={plan.id} className="p-4 bg-muted/30 border border-border rounded-xl space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-sm text-foreground">{plan.label}</p>
                          <p className="text-xs text-muted-foreground">
                            This cycle: <span className="font-medium text-foreground">LKR <MaskedAmount amount={plan.cycleAmount} /></span>
                          </p>
                        </div>
                        <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent text-xs font-semibold">
                          {plan.currentInstallment} of {plan.totalInstallments} Months
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1">
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{pct}% complete</span>
                          <span>
                            Est. Remaining: <span className="font-medium text-foreground">LKR <MaskedAmount amount={plan.estimatedRemainingBalance} /></span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Categorized Spending Breakdown (Grouped sums, NO charts) ───────── */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground text-sm">Where the Money Went (Categorized Breakdown)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Grouped category totals extracted from statement descriptions.
                </p>
              </div>

              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search statement items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-muted/60 border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            {/* Filtered Search Results */}
            {filteredTxns ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Found {filteredTxns.length} matching transaction{filteredTxns.length !== 1 ? 's' : ''}:
                </p>
                <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                  {filteredTxns.map(t => (
                    <div key={t.id} className="p-3 bg-muted/20 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-medium text-foreground">{t.description}</p>
                        <p className="text-[11px] text-muted-foreground">{t.transactionDate} · {t.category}</p>
                      </div>
                      <p className={`font-semibold ${t.isCredit ? 'text-emerald-500' : 'text-foreground'}`}>
                        {t.isCredit ? '−' : ''}LKR <MaskedAmount amount={t.amount} />
                        {t.isCredit && <span className="ml-1 text-[10px] text-emerald-500 font-mono">CR</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Grouped Category Accordion */
              <div className="space-y-2.5">
                {categoryGroups.map(group => {
                  const isExpanded = !!expandedCategories[group.category];
                  const sharePct = activeStatement.totalPurchases > 0
                    ? Math.round((group.total / activeStatement.totalPurchases) * 100)
                    : 0;

                  return (
                    <div key={group.category} className="border border-border rounded-xl overflow-hidden bg-muted/20">
                      <button
                        onClick={() => toggleCategory(group.category)}
                        className="w-full p-3.5 flex items-center justify-between hover:bg-muted/40 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                          <div>
                            <p className="text-xs font-semibold text-foreground">{group.category}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {group.txns.length} transaction{group.txns.length !== 1 ? 's' : ''} ({sharePct}% of purchases)
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-xs font-bold text-foreground">
                            LKR <MaskedAmount amount={group.total} />
                          </p>
                        </div>
                      </button>

                      {/* Expandable Line-item details */}
                      {isExpanded && (
                        <div className="border-t border-border/60 bg-muted/40 divide-y divide-border/50">
                          {group.txns.map(t => (
                            <div key={t.id} className="px-5 py-2.5 flex items-center justify-between text-xs">
                              <div>
                                <p className="font-medium text-foreground">{t.description}</p>
                                <p className="text-[11px] text-muted-foreground">Txn Date: {t.transactionDate} (Processed: {t.processedDate})</p>
                              </div>
                              <p className="font-semibold text-foreground">
                                LKR <MaskedAmount amount={t.amount} />
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Payments Received Section (CR lines) ────────────────────────────── */}
          {paymentsList.length > 0 && (
            <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-foreground text-sm">Payments &amp; Credits Received</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Credits logged by the bank this cycle (marked with CR).
                  </p>
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-xl">
                  Total: LKR <MaskedAmount amount={activeStatement.totalPayments} />
                </span>
              </div>

              <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
                {paymentsList.map(t => (
                  <div key={t.id} className="p-3 bg-muted/20 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-medium text-foreground">{t.description}</p>
                      <p className="text-[11px] text-muted-foreground">Processed: {t.processedDate} · Txn Date: {t.transactionDate}</p>
                    </div>
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                      LKR <MaskedAmount amount={t.amount} /> CR
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Upload Modal ────────────────────────────────────────────────────── */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-card border border-border w-full max-w-lg rounded-2xl shadow-xl overflow-hidden space-y-5 p-6">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-accent" />
                <h3 className="font-semibold text-foreground text-sm">Upload Credit Card Statement</h3>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </div>

            {/* Step A: Pick / Name the Card */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                1. Card Profile (Optional — Auto-detected from PDF)
              </label>
              {cards.length > 0 && !isCreatingCard ? (
                <div className="space-y-2">
                  <select
                    value={uploadCardId}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setIsCreatingCard(true);
                        setUploadCardId('');
                      } else {
                        setUploadCardId(e.target.value);
                      }
                    }}
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="">⚡ Auto-detect card profile from statement PDF</option>
                    {cards.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.label} {c.last4 ? `(•••• ${c.last4})` : ''}
                      </option>
                    ))}
                    <option value="__new__">+ Specify custom card name</option>
                  </select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    placeholder="e.g. Combank Visa Platinum (or leave blank to auto-detect)"
                    value={newCardLabel}
                    onChange={(e) => setNewCardLabel(e.target.value)}
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {cards.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsCreatingCard(false)}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline"
                    >
                      Choose existing card profile instead
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Step B: Dropzone */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                2. Select Commercial Bank PDF Statement
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.[0]) {
                    handleFileUpload(e.dataTransfer.files[0]);
                  }
                }}
                className="border-2 border-dashed border-border hover:border-accent rounded-xl p-8 text-center cursor-pointer transition-colors space-y-2 bg-muted/20"
              >
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                  <Upload size={18} />
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">Click to browse or drag and drop</p>
                  <p className="text-[11px] text-muted-foreground">Accepts Combank credit card statement (.pdf)</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                />
              </div>
            </div>

            {/* Error Message */}
            {parseError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-500 flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}

            {/* Parsing Indicator */}
            {isParsing && (
              <div className="p-3 bg-accent/10 border border-accent/20 rounded-xl text-xs text-accent flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                <span>Extracting statement text and parsing layout client-side...</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ShieldCheck size={13} className="text-emerald-500" />
                Zero network transmission
              </span>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-muted text-foreground hover:bg-muted/80 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
