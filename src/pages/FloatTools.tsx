import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type {
  CreditCard,
  InstallmentPlan,
  CardPromo,
  FloatGapHistory,
  ReimbursementLedger,
  ReimbursementEntry,
} from '../db/db';
import { Link } from 'react-router-dom';
import { format, differenceInDays } from 'date-fns';
import { triggerSync, deleteFromCloud } from '../sync/syncEngine';
import {
  ChevronLeft,
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus as MinusIcon,
  CreditCard as CardIcon,
  BookOpen,
  BarChart2,
  Landmark,
  X,
  Check,
} from 'lucide-react';

// ─── Pure helpers ────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).substring(2, 10);
}

function fmt(n: number): string {
  return Math.abs(n).toLocaleString();
}

function getCardExposure(cardId: string, history: FloatGapHistory[]): number {
  const sorted = history
    .filter(h => h.cardId === cardId)
    .sort((a, b) => a.cycleLabel.localeCompare(b.cycleLabel));
  return sorted.length > 0 ? sorted[sorted.length - 1].cumulativeGap : 0;
}

function getDueDateInfo(card: CreditCard): {
  daysUntilDue: number;
  isOverdue: boolean;
  warningType: 'shortfall' | 'carry' | 'ok';
  warningMessage: string | null;
} {
  const daysUntilDue = differenceInDays(new Date(card.dueDate), new Date());
  const isOverdue = daysUntilDue < 0;

  if (card.payInFullIntent) {
    if (card.currentBalance > 0) {
      return {
        daysUntilDue,
        isOverdue,
        warningType: 'shortfall',
        warningMessage: `LKR ${fmt(card.currentBalance)} unpaid — full payment expected by ${format(new Date(card.dueDate), 'MMM d')}`,
      };
    }
  } else {
    if (card.currentBalance > 0) {
      const monthlyCost = Math.round((card.currentBalance * card.aprPercent) / 100 / 12);
      return {
        daysUntilDue,
        isOverdue,
        warningType: 'carry',
        warningMessage: `Carrying balance · est. APR cost LKR ${fmt(monthlyCost)}/mo`,
      };
    }
  }

  return { daysUntilDue, isOverdue, warningType: 'ok', warningMessage: null };
}

function getLedgerBalance(entries: ReimbursementEntry[]): number {
  return entries.reduce((sum, e) => sum + e.delta, 0);
}

function getLedgerTrend(entries: ReimbursementEntry[]): 'growing' | 'shrinking' | 'stable' {
  if (entries.length < 3) return 'stable';
  const recent = [...entries].sort((a, b) => a.date - b.date).slice(-5);
  let running = 0;
  const balances: number[] = [];
  for (const e of recent) {
    running += e.delta;
    balances.push(running);
  }
  const change = balances[balances.length - 1] - balances[0];
  if (change > 200) return 'growing';
  if (change < -200) return 'shrinking';
  return 'stable';
}

// ─── SVG Gap Trend Chart ─────────────────────────────────────────────────────

function GapTrendChart({ history }: { history: FloatGapHistory[] }) {
  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-28 text-xs text-muted-foreground">
        No gap history yet — add cycle entries to see the trend.
      </div>
    );
  }
  if (history.length === 1) {
    return (
      <div className="flex items-center justify-center h-28 text-xs text-muted-foreground">
        Add at least 2 cycles to plot a trend line.
      </div>
    );
  }

  const W = 500;
  const H = 160;
  const PAD = { top: 16, right: 24, bottom: 32, left: 76 };
  const pw = W - PAD.left - PAD.right;
  const ph = H - PAD.top - PAD.bottom;

  const vals = history.map(h => h.cumulativeGap);
  const minV = Math.min(0, ...vals);
  const maxV = Math.max(0, ...vals);
  const range = maxV - minV || 1;

  const xOf = (i: number) => PAD.left + (i / (history.length - 1)) * pw;
  const yOf = (v: number) => PAD.top + (1 - (v - minV) / range) * ph;
  const zeroY = yOf(0);

  const linePath = history
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(h.cumulativeGap).toFixed(1)}`)
    .join(' ');

  const yTicks = Array.from(new Set([minV, 0, maxV]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-label="Float gap trend">
      {minV < 0 && (
        <line
          x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY}
          stroke="currentColor" strokeDasharray="4 3" opacity={0.2}
        />
      )}
      <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {history.map((h, i) => (
        <circle
          key={h.id}
          cx={xOf(i)} cy={yOf(h.cumulativeGap)} r={4}
          fill={h.cumulativeGap < 0 ? '#ef4444' : '#3b82f6'}
          stroke="var(--background, #fff)" strokeWidth={2}
        />
      ))}
      {history.map((h, i) => (
        <text key={`xl-${h.id}`} x={xOf(i)} y={H - 6}
          textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.45} fontFamily="ui-monospace, monospace">
          {h.cycleLabel.slice(2)}
        </text>
      ))}
      {yTicks.map(v => (
        <text key={`yl-${v}`} x={PAD.left - 6} y={yOf(v) + 4}
          textAnchor="end" fontSize={9} fill="currentColor" opacity={0.45} fontFamily="ui-monospace, monospace">
          {v < 0 ? '-' : ''}{Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1)}k` : Math.abs(v)}
        </text>
      ))}
    </svg>
  );
}

// ─── Payoff Simulator ────────────────────────────────────────────────────────

function PayoffSimulator({ gapAmount, monthlyAmount, planName }: {
  gapAmount: number;
  monthlyAmount: number;
  planName: string;
}) {
  if (monthlyAmount <= 0 || gapAmount <= 0) return null;
  const months = Math.ceil(gapAmount / monthlyAmount);
  const rows: { month: number; remaining: number }[] = [];
  let rem = gapAmount;
  for (let m = 1; m <= Math.min(months, 36); m++) {
    rem = Math.max(0, rem - monthlyAmount);
    rows.push({ month: m, remaining: rem });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{planName}</span> is complete —
        LKR <span className="font-mono font-semibold text-foreground">{fmt(monthlyAmount)}</span>/mo now freed up.
        Applying it to the gap closes it in{' '}
        <span className="font-semibold text-foreground">{months} month{months !== 1 ? 's' : ''}</span>.
      </p>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="p-2.5 text-left font-semibold text-muted-foreground">Month</th>
              <th className="p-2.5 text-right font-semibold text-muted-foreground">Remaining Gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.month} className={r.remaining === 0 ? 'bg-emerald-500/5' : ''}>
                <td className="p-2.5 font-mono text-muted-foreground">{r.month}</td>
                <td className={`p-2.5 text-right font-mono font-semibold ${r.remaining === 0 ? 'text-emerald-500' : 'text-foreground'}`}>
                  {r.remaining === 0 ? 'Closed' : `LKR ${fmt(r.remaining)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type Tab = 'overview' | 'cards' | 'gap' | 'ledgers' | 'interest';

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <BarChart2 size={14} /> },
  { key: 'cards', label: 'Cards & Sources', icon: <CardIcon size={14} /> },
  { key: 'gap', label: 'Float Gap', icon: <TrendingUp size={14} /> },
  { key: 'ledgers', label: 'Ledgers', icon: <BookOpen size={14} /> },
  { key: 'interest', label: 'Interest', icon: <Landmark size={14} /> },
];

export default function FloatTools() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const cards      = useLiveQuery(() => db.creditCards.toArray())          ?? [];
  const offsets    = useLiveQuery(() => db.cashOffsetSources.toArray())    ?? [];
  const fds        = useLiveQuery(() => db.fixedDeposits.toArray())        ?? [];
  const mmas       = useLiveQuery(() => db.moneyMarketAccounts.toArray())  ?? [];
  const plans      = useLiveQuery(() => db.installmentPlans.toArray())     ?? [];
  const promos     = useLiveQuery(() => db.cardPromos.toArray())           ?? [];
  const gapHistory = useLiveQuery(() => db.floatGapHistory.toArray())      ?? [];
  const ledgers    = useLiveQuery(() => db.reimbursementLedgers.toArray()) ?? [];
  const entries    = useLiveQuery(() => db.reimbursementEntries.toArray()) ?? [];

  const [selectedCardId,       setSelectedCardId]       = useState('');
  const [selectedLedgerId,     setSelectedLedgerId]     = useState('');
  const [interestCardId,       setInterestCardId]       = useState('');
  const [isAddingGap,          setIsAddingGap]          = useState(false);
  const [gapForm,              setGapForm]              = useState({ cycleLabel: '', totalBill: '', cashReceived: '' });
  const [isAddingLedger,       setIsAddingLedger]       = useState(false);
  const [newLedgerName,        setNewLedgerName]        = useState('');
  const [isAddingEntry,        setIsAddingEntry]        = useState(false);
  const [entryForm,            setEntryForm]            = useState({ note: '', amountOwed: '', amountPaid: '', dateStr: new Date().toISOString().slice(0, 10) });
  const [isAddingCard,         setIsAddingCard]         = useState(false);
  const [editingCard,          setEditingCard]          = useState<CreditCard | null>(null);
  const [cardForm,             setCardForm]             = useState({ name: '', creditLimit: '', currentBalance: '', aprPercent: '', graceMinDays: '18', graceMaxDays: '25', dueDate: '', cycleStartDay: '1', payInFullIntent: true });
  const [isAddingOffset,       setIsAddingOffset]       = useState(false);
  const [offsetForm,           setOffsetForm]           = useState({ name: '', linkedCardId: '', expectedMonthlyAmount: '', category: '' });
  const [isAddingFD,           setIsAddingFD]           = useState(false);
  const [fdForm,               setFdForm]               = useState({ name: '', principal: '', ratePercent: '', maturityIntervalMonths: '12', linkedCardId: '' });
  const [isAddingMMA,          setIsAddingMMA]          = useState(false);
  const [mmaForm,              setMmaForm]              = useState({ name: '', balance: '', currentRatePercent: '', minimumBalanceForRate: '', baseRatePercent: '' });
  const [isAddingPlan,         setIsAddingPlan]         = useState(false);
  const [planForm,             setPlanForm]             = useState({ linkedCardId: '', description: '', totalAmount: '', monthlyAmount: '', totalMonths: '', monthsPaid: '0' });
  const [isAddingPromo,        setIsAddingPromo]        = useState(false);
  const [promoForm,            setPromoForm]            = useState({ linkedCardId: '', description: '', spendThreshold: '', minTransactionCount: '', windowStart: '', windowEnd: '', cashbackPercent: '', cashbackCap: '', currentSpend: '0', currentTransactionCount: '0' });

  const totalExposure = useMemo(
    () => cards.reduce((sum, c) => sum + getCardExposure(c.id, gapHistory), 0),
    [cards, gapHistory],
  );
  const activePlans    = useMemo(() => plans.filter(p => p.active), [plans]);
  const completedPlans = useMemo(() => plans.filter(p => !p.active && p.monthsPaid >= p.totalMonths), [plans]);
  const activePromos   = useMemo(() => { const n = Date.now(); return promos.filter(p => p.windowEnd > n); }, [promos]);

  const resolvedCardId        = selectedCardId   || cards[0]?.id   || '';
  const resolvedLedgerId      = selectedLedgerId || ledgers[0]?.id || '';
  const resolvedInterestCardId = interestCardId  || cards[0]?.id   || '';

  const selectedCardHistory = useMemo(
    () => [...gapHistory.filter(h => h.cardId === resolvedCardId)].sort((a, b) => a.cycleLabel.localeCompare(b.cycleLabel)),
    [gapHistory, resolvedCardId],
  );
  const selectedLedgerEntries = useMemo(
    () => [...entries.filter(e => e.ledgerId === resolvedLedgerId)].sort((a, b) => a.date - b.date),
    [entries, resolvedLedgerId],
  );
  const interestCard = useMemo(() => cards.find(c => c.id === resolvedInterestCardId), [cards, resolvedInterestCardId]);
  const linkedFD     = useMemo(() => fds.find(f => f.linkedCardId === interestCard?.id), [fds, interestCard]);

  const inputCls = 'w-full px-3 py-2 bg-background border border-border rounded-xl text-sm text-foreground font-medium outline-none focus:border-foreground transition-colors';
  const labelCls = 'block text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider';
  const cardCls  = 'bg-card border border-border rounded-2xl shadow-sm overflow-hidden';

  // ── Card CRUD

  function resetCardForm() {
    setCardForm({ name: '', creditLimit: '', currentBalance: '', aprPercent: '', graceMinDays: '18', graceMaxDays: '25', dueDate: '', cycleStartDay: '1', payInFullIntent: true });
    setEditingCard(null);
    setIsAddingCard(false);
  }

  async function handleSaveCard() {
    if (!cardForm.name.trim()) return;
    const payload: Omit<CreditCard, 'id'> = {
      name: cardForm.name.trim(),
      creditLimit:    parseFloat(cardForm.creditLimit)    || 0,
      currentBalance: parseFloat(cardForm.currentBalance) || 0,
      aprPercent:     parseFloat(cardForm.aprPercent)     || 0,
      graceMinDays:   parseInt(cardForm.graceMinDays)     || 18,
      graceMaxDays:   parseInt(cardForm.graceMaxDays)     || 25,
      dueDate: cardForm.dueDate ? new Date(cardForm.dueDate).getTime() : Date.now() + 30 * 864e5,
      cycleStartDay: parseInt(cardForm.cycleStartDay) || 1,
      payInFullIntent: cardForm.payInFullIntent,
      updatedAt: Date.now(),
    };
    if (editingCard) {
      await db.creditCards.update(editingCard.id, payload);
    } else {
      await db.creditCards.add({ id: `cc-${Date.now()}-${uid()}`, ...payload });
    }
    triggerSync();
    resetCardForm();
  }

  function openEditCard(card: CreditCard) {
    setEditingCard(card);
    setCardForm({ name: card.name, creditLimit: String(card.creditLimit), currentBalance: String(card.currentBalance), aprPercent: String(card.aprPercent), graceMinDays: String(card.graceMinDays), graceMaxDays: String(card.graceMaxDays), dueDate: format(new Date(card.dueDate), 'yyyy-MM-dd'), cycleStartDay: String(card.cycleStartDay), payInFullIntent: card.payInFullIntent });
    setIsAddingCard(true);
  }

  async function handleDeleteCard(id: string) {
    if (!confirm('Delete this card and all its associated data?')) return;
    await db.creditCards.delete(id);
    await deleteFromCloud('credit_cards', id);

    const offsetIds = (await db.cashOffsetSources.where('linkedCardId').equals(id).toArray()).map(o => o.id);
    await db.cashOffsetSources.where('linkedCardId').equals(id).delete();
    for (const oid of offsetIds) await deleteFromCloud('cash_offset_sources', oid);

    const planIds = (await db.installmentPlans.where('linkedCardId').equals(id).toArray()).map(p => p.id);
    await db.installmentPlans.where('linkedCardId').equals(id).delete();
    for (const pid of planIds) await deleteFromCloud('installment_plans', pid);

    const promoIds = (await db.cardPromos.where('linkedCardId').equals(id).toArray()).map(pr => pr.id);
    await db.cardPromos.where('linkedCardId').equals(id).delete();
    for (const pid of promoIds) await deleteFromCloud('card_promos', pid);

    const gapIds = (await db.floatGapHistory.where('cardId').equals(id).toArray()).map(g => g.id);
    await db.floatGapHistory.where('cardId').equals(id).delete();
    for (const gid of gapIds) await deleteFromCloud('float_gap_history', gid);

    triggerSync();
  }

  async function handleSaveOffset() {
    if (!offsetForm.name.trim() || !offsetForm.linkedCardId) return;
    await db.cashOffsetSources.add({ id: `cos-${Date.now()}-${uid()}`, name: offsetForm.name.trim(), linkedCardId: offsetForm.linkedCardId, expectedMonthlyAmount: parseFloat(offsetForm.expectedMonthlyAmount) || 0, category: offsetForm.category.trim() || undefined, updatedAt: Date.now() });
    triggerSync();
    setOffsetForm({ name: '', linkedCardId: '', expectedMonthlyAmount: '', category: '' });
    setIsAddingOffset(false);
  }

  async function handleDeleteOffset(id: string) {
    await db.cashOffsetSources.delete(id);
    await deleteFromCloud('cash_offset_sources', id);
    triggerSync();
  }

  async function handleSaveFD() {
    if (!fdForm.name.trim()) return;
    await db.fixedDeposits.add({ id: `fd-${Date.now()}-${uid()}`, name: fdForm.name.trim(), principal: parseFloat(fdForm.principal) || 0, ratePercent: parseFloat(fdForm.ratePercent) || 0, maturityIntervalMonths: parseInt(fdForm.maturityIntervalMonths) || 12, linkedCardId: fdForm.linkedCardId || undefined, updatedAt: Date.now() });
    triggerSync();
    setFdForm({ name: '', principal: '', ratePercent: '', maturityIntervalMonths: '12', linkedCardId: '' });
    setIsAddingFD(false);
  }

  async function handleDeleteFD(id: string) {
    await db.fixedDeposits.delete(id);
    await deleteFromCloud('fixed_deposits', id);
    triggerSync();
  }

  async function handleSaveMMA() {
    if (!mmaForm.name.trim()) return;
    await db.moneyMarketAccounts.add({ id: `mma-${Date.now()}-${uid()}`, name: mmaForm.name.trim(), balance: parseFloat(mmaForm.balance) || 0, currentRatePercent: parseFloat(mmaForm.currentRatePercent) || 0, minimumBalanceForRate: parseFloat(mmaForm.minimumBalanceForRate) || 0, baseRatePercent: parseFloat(mmaForm.baseRatePercent) || 0, updatedAt: Date.now() });
    triggerSync();
    setMmaForm({ name: '', balance: '', currentRatePercent: '', minimumBalanceForRate: '', baseRatePercent: '' });
    setIsAddingMMA(false);
  }

  async function handleDeleteMMA(id: string) {
    await db.moneyMarketAccounts.delete(id);
    await deleteFromCloud('money_market_accounts', id);
    triggerSync();
  }

  async function handleSavePlan() {
    if (!planForm.description.trim() || !planForm.linkedCardId) return;
    const totalMonths = parseInt(planForm.totalMonths) || 1;
    const monthsPaid  = parseInt(planForm.monthsPaid)  || 0;
    await db.installmentPlans.add({ id: `plan-${Date.now()}-${uid()}`, linkedCardId: planForm.linkedCardId, description: planForm.description.trim(), totalAmount: parseFloat(planForm.totalAmount) || 0, monthlyAmount: parseFloat(planForm.monthlyAmount) || 0, totalMonths, monthsPaid, active: monthsPaid < totalMonths, updatedAt: Date.now() });
    triggerSync();
    setPlanForm({ linkedCardId: '', description: '', totalAmount: '', monthlyAmount: '', totalMonths: '', monthsPaid: '0' });
    setIsAddingPlan(false);
  }

  async function handleMarkPlanPaid(plan: InstallmentPlan) {
    const next = plan.monthsPaid + 1;
    await db.installmentPlans.update(plan.id, { monthsPaid: next, active: next < plan.totalMonths, updatedAt: Date.now() });
    triggerSync();
  }

  async function handleDeletePlan(id: string) {
    await db.installmentPlans.delete(id);
    await deleteFromCloud('installment_plans', id);
    triggerSync();
  }

  async function handleSavePromo() {
    if (!promoForm.description.trim() || !promoForm.linkedCardId) return;
    await db.cardPromos.add({ id: `promo-${Date.now()}-${uid()}`, linkedCardId: promoForm.linkedCardId, description: promoForm.description.trim(), spendThreshold: parseFloat(promoForm.spendThreshold) || 0, minTransactionCount: parseInt(promoForm.minTransactionCount) || 0, windowStart: promoForm.windowStart ? new Date(promoForm.windowStart).getTime() : Date.now(), windowEnd: promoForm.windowEnd ? new Date(promoForm.windowEnd).getTime() : Date.now(), cashbackPercent: parseFloat(promoForm.cashbackPercent) || 0, cashbackCap: parseFloat(promoForm.cashbackCap) || 0, currentSpend: parseFloat(promoForm.currentSpend) || 0, currentTransactionCount: parseInt(promoForm.currentTransactionCount) || 0, updatedAt: Date.now() });
    triggerSync();
    setPromoForm({ linkedCardId: '', description: '', spendThreshold: '', minTransactionCount: '', windowStart: '', windowEnd: '', cashbackPercent: '', cashbackCap: '', currentSpend: '0', currentTransactionCount: '0' });
    setIsAddingPromo(false);
  }

  async function handleUpdatePromoProgress(promo: CardPromo, field: 'currentSpend' | 'currentTransactionCount', value: string) {
    const updates = field === 'currentSpend'
      ? { currentSpend: parseFloat(value) || 0, updatedAt: Date.now() }
      : { currentTransactionCount: parseInt(value) || 0, updatedAt: Date.now() };
    await db.cardPromos.update(promo.id, updates);
    triggerSync();
  }

  async function handleDeletePromo(id: string) {
    await db.cardPromos.delete(id);
    await deleteFromCloud('card_promos', id);
    triggerSync();
  }

  async function handleAddGapEntry() {
    if (!resolvedCardId || !gapForm.cycleLabel) return;
    const totalBill    = parseFloat(gapForm.totalBill)    || 0;
    const cashReceived = parseFloat(gapForm.cashReceived) || 0;
    const delta = cashReceived - totalBill;
    const fresh = await db.floatGapHistory.where('cardId').equals(resolvedCardId).toArray();
    const sortedFresh = fresh.sort((a, b) => a.cycleLabel.localeCompare(b.cycleLabel));
    const prevCumulative = sortedFresh.length > 0 ? sortedFresh[sortedFresh.length - 1].cumulativeGap : 0;
    await db.floatGapHistory.add({ id: `gap-${Date.now()}-${uid()}`, cardId: resolvedCardId, cycleLabel: gapForm.cycleLabel, totalBill, cashReceived, delta, cumulativeGap: prevCumulative + delta, updatedAt: Date.now() });
    triggerSync();
    setGapForm({ cycleLabel: '', totalBill: '', cashReceived: '' });
    setIsAddingGap(false);
  }

  async function handleDeleteGapEntry(entry: FloatGapHistory) {
    await db.floatGapHistory.delete(entry.id);
    await deleteFromCloud('float_gap_history', entry.id);
    const fresh = await db.floatGapHistory.where('cardId').equals(entry.cardId).toArray();
    const sorted = fresh.sort((a, b) => a.cycleLabel.localeCompare(b.cycleLabel));
    let running = 0;
    for (const h of sorted) {
      running += h.delta;
      await db.floatGapHistory.update(h.id, { cumulativeGap: running, updatedAt: Date.now() });
    }
    triggerSync();
  }

  async function handleAddLedger() {
    if (!newLedgerName.trim()) return;
    const id = `ledger-${Date.now()}-${uid()}`;
    await db.reimbursementLedgers.add({ id, counterpartyName: newLedgerName.trim(), updatedAt: Date.now() });
    triggerSync();
    setNewLedgerName('');
    setIsAddingLedger(false);
    setSelectedLedgerId(id);
  }

  async function handleDeleteLedger(ledger: ReimbursementLedger) {
    if (!confirm(`Delete the "${ledger.counterpartyName}" ledger and all its entries?`)) return;
    const entryIds = (await db.reimbursementEntries.where('ledgerId').equals(ledger.id).toArray()).map(e => e.id);
    await db.reimbursementEntries.where('ledgerId').equals(ledger.id).delete();
    for (const eid of entryIds) await deleteFromCloud('reimbursement_entries', eid);
    await db.reimbursementLedgers.delete(ledger.id);
    await deleteFromCloud('reimbursement_ledgers', ledger.id);
    triggerSync();
    setSelectedLedgerId('');
  }

  async function handleAddEntry() {
    if (!resolvedLedgerId || !entryForm.note.trim()) return;
    const amountOwed = parseFloat(entryForm.amountOwed) || 0;
    const amountPaid = parseFloat(entryForm.amountPaid) || 0;
    await db.reimbursementEntries.add({ id: `entry-${Date.now()}-${uid()}`, ledgerId: resolvedLedgerId, date: entryForm.dateStr ? new Date(entryForm.dateStr).getTime() : Date.now(), note: entryForm.note.trim(), amountOwed, amountPaid, delta: amountPaid - amountOwed, updatedAt: Date.now() });
    triggerSync();
    setEntryForm({ note: '', amountOwed: '', amountPaid: '', dateStr: new Date().toISOString().slice(0, 10) });
    setIsAddingEntry(false);
  }

  async function handleDeleteEntry(id: string) {
    await db.reimbursementEntries.delete(id);
    await deleteFromCloud('reimbursement_entries', id);
    triggerSync();
  }

  return (
    <div className="p-6 pb-28 max-w-5xl mx-auto">

      <div className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground">
        <Link to="/settings" className="hover:text-foreground transition-colors flex items-center gap-0.5">
          <ChevronLeft size={14} /> Settings
        </Link>
        <span>/</span>
        <span>Credit &amp; Float Tools</span>
      </div>
      <h2 className="text-2xl font-medium text-foreground mb-6">Credit &amp; Float Tools</h2>

      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <section className={cardCls}>
            <div className="p-6">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Exposure — Stress Test</p>
              {cards.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add a credit card to begin tracking exposure.</p>
              ) : totalExposure === 0 ? (
                <div>
                  <p className="font-mono text-3xl font-semibold text-emerald-500">LKR 0</p>
                  <p className="text-xs text-muted-foreground mt-1">No float gap on record yet.</p>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">If all offset inflows stopped today, you would owe out of pocket:</p>
                  <p className={`font-mono text-4xl font-semibold ${totalExposure < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                    LKR {fmt(totalExposure)}
                    {totalExposure < 0 && <span className="text-lg text-muted-foreground ml-2">gap</span>}
                    {totalExposure > 0 && <span className="text-lg text-muted-foreground ml-2">ahead</span>}
                  </p>
                  {cards.length > 1 && (
                    <div className="mt-3 space-y-0.5">
                      {cards.map(c => {
                        const exp = getCardExposure(c.id, gapHistory);
                        if (exp === 0) return null;
                        return (
                          <p key={c.id} className="text-xs text-muted-foreground font-mono">
                            <span className="font-semibold text-foreground">{c.name}:</span>{' '}
                            {exp < 0 ? '-' : '+'}LKR {fmt(exp)} {exp < 0 ? 'gap' : 'ahead'}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {cards.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Available Credit</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {cards.map(card => {
                  const available = card.creditLimit - card.currentBalance;
                  const usedPct   = card.creditLimit > 0 ? (card.currentBalance / card.creditLimit) * 100 : 0;
                  const info      = getDueDateInfo(card);
                  return (
                    <div key={card.id} className={`${cardCls} p-4`}>
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-semibold text-foreground text-sm">{card.name}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Due {format(new Date(card.dueDate), 'MMM d')} · {card.aprPercent}% APR{!card.payInFullIntent && ' · carry intent'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-semibold text-foreground text-sm">LKR {fmt(available)}</p>
                          <p className="text-[11px] text-muted-foreground">available</p>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                        <div className={`h-full rounded-full transition-all ${usedPct > 80 ? 'bg-red-500' : usedPct > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, usedPct)}%` }} />
                      </div>
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span className="font-mono">LKR {fmt(card.currentBalance)} used</span>
                        <span className="font-mono">{usedPct.toFixed(0)}% of {fmt(card.creditLimit)}</span>
                      </div>
                      {info.warningMessage && (
                        <p className={`text-[11px] font-medium mt-2 ${info.warningType === 'shortfall' ? 'text-red-500' : 'text-amber-500'}`}>
                          {info.warningType === 'shortfall' && '🔴 '}{info.warningMessage}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {cards.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Upcoming Due Dates</h3>
              <div className={`${cardCls} divide-y divide-border`}>
                {[...cards].sort((a, b) => a.dueDate - b.dueDate).map(card => {
                  const info = getDueDateInfo(card);
                  return (
                    <div key={card.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-semibold text-foreground text-sm">{card.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(card.dueDate), 'MMM d, yyyy')}
                          {info.isOverdue ? ' · Overdue' : ` · ${info.daysUntilDue}d remaining`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-semibold text-foreground text-sm">LKR {fmt(card.currentBalance)}</p>
                        {info.warningType === 'shortfall' && <span className="flex items-center gap-1 text-[11px] text-red-500 justify-end mt-0.5"><AlertTriangle size={10} /> Pay in full</span>}
                        {info.warningType === 'carry'    && <span className="text-[11px] text-amber-500">Carrying balance</span>}
                        {info.warningType === 'ok' && card.currentBalance === 0 && <span className="text-[11px] text-emerald-500">Clear</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {activePlans.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Active Installment Load</h3>
              <div className="space-y-2">
                {activePlans.map(plan => {
                  const card = cards.find(c => c.id === plan.linkedCardId);
                  const pct  = plan.totalMonths > 0 ? (plan.monthsPaid / plan.totalMonths) * 100 : 0;
                  return (
                    <div key={plan.id} className={`${cardCls} p-4`}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-foreground text-sm">{plan.description}</p>
                          <p className="text-xs text-muted-foreground">{card?.name ?? '-'} · {plan.monthsPaid}/{plan.totalMonths} months paid</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-semibold text-foreground text-sm">LKR {fmt(plan.monthlyAmount)}/mo</p>
                          <p className="text-[11px] text-muted-foreground">{plan.totalMonths - plan.monthsPaid} left</p>
                        </div>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {activePromos.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Active Promo Progress</h3>
              <div className="space-y-3">
                {activePromos.map(promo => {
                  const card     = cards.find(c => c.id === promo.linkedCardId);
                  const spendPct = promo.spendThreshold > 0 ? Math.min(100, (promo.currentSpend / promo.spendThreshold) * 100) : 100;
                  const txnPct   = promo.minTransactionCount > 0 ? Math.min(100, (promo.currentTransactionCount / promo.minTransactionCount) * 100) : 100;
                  const daysLeft = differenceInDays(new Date(promo.windowEnd), new Date());
                  const proj     = Math.min(promo.cashbackCap, (promo.currentSpend * promo.cashbackPercent) / 100);
                  return (
                    <div key={promo.id} className={`${cardCls} p-4`}>
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-semibold text-foreground text-sm">{promo.description}</p>
                          <p className="text-xs text-muted-foreground">{card?.name ?? '-'} · {daysLeft}d remaining</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground">Projected</p>
                          <p className={`font-mono font-semibold text-sm ${spendPct >= 100 && txnPct >= 100 ? 'text-emerald-500' : 'text-foreground'}`}>LKR {fmt(Math.round(proj))}</p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div>
                          <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5"><span>Spend</span><span className="font-mono">LKR {fmt(promo.currentSpend)} / {fmt(promo.spendThreshold)}</span></div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full rounded-full ${spendPct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${spendPct}%` }} /></div>
                        </div>
                        {promo.minTransactionCount > 0 && (
                          <div>
                            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5"><span>Transactions</span><span className="font-mono">{promo.currentTransactionCount} / {promo.minTransactionCount}</span></div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full rounded-full ${txnPct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${txnPct}%` }} /></div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {ledgers.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Reimbursement Balances</h3>
              <div className={`${cardCls} divide-y divide-border`}>
                {ledgers.map(ledger => {
                  const led     = entries.filter(e => e.ledgerId === ledger.id);
                  const balance = getLedgerBalance(led);
                  const trend   = getLedgerTrend(led);
                  const pos     = balance > 0;
                  return (
                    <button key={ledger.id} onClick={() => { setSelectedLedgerId(ledger.id); setActiveTab('ledgers'); }} className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors text-left">
                      <div>
                        <p className="font-semibold text-foreground text-sm">{ledger.counterpartyName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{balance === 0 ? 'Settled' : pos ? `${ledger.counterpartyName} owes you` : `You owe ${ledger.counterpartyName}`}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {trend === 'growing'  && <TrendingUp  size={13} className="text-emerald-500" />}
                        {trend === 'shrinking' && <TrendingDown size={13} className="text-red-400" />}
                        {trend === 'stable'   && <MinusIcon   size={13} className="text-muted-foreground" />}
                        <p className={`font-mono font-semibold text-sm ${balance === 0 ? 'text-muted-foreground' : pos ? 'text-emerald-500' : 'text-red-500'}`}>LKR {fmt(balance)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {cards.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">Float Gap Trend</h3>
                {cards.length > 1 && (
                  <select value={resolvedCardId} onChange={e => setSelectedCardId(e.target.value)} className="text-xs bg-muted border border-border rounded-lg px-2 py-1 text-foreground">
                    {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
              <div className={`${cardCls} p-4`}><GapTrendChart history={selectedCardHistory} /></div>
            </section>
          )}

          {cards.length === 0 && (
            <div className="text-center py-16">
              <CardIcon size={44} className="mx-auto text-muted-foreground opacity-20 mb-4" />
              <p className="text-sm font-medium text-foreground mb-1">No credit cards added yet</p>
              <p className="text-xs text-muted-foreground mb-5">Add your cards in the Cards &amp; Sources tab to start tracking.</p>
              <button onClick={() => setActiveTab('cards')} className="px-4 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-semibold">Add Your First Card</button>
            </div>
          )}
        </div>
      )}

      {/* CARDS & SOURCES */}
      {activeTab === 'cards' && (
        <div className="space-y-10">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Credit Cards</h3>
              <button onClick={() => setIsAddingCard(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"><Plus size={14} /> Add Card</button>
            </div>
            {isAddingCard && (
              <div className={`${cardCls} p-5 mb-4`}>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-foreground">{editingCard ? 'Edit Card' : 'New Credit Card'}</h4>
                  <button onClick={resetCardForm}><X size={16} className="text-muted-foreground" /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={labelCls}>Card Name</label><input className={inputCls} placeholder="Visa Platinum" value={cardForm.name} onChange={e => setCardForm(f => ({...f, name: e.target.value}))} /></div>
                  <div><label className={labelCls}>Credit Limit (LKR)</label><input type="number" className={inputCls} placeholder="200000" value={cardForm.creditLimit} onChange={e => setCardForm(f => ({...f, creditLimit: e.target.value}))} /></div>
                  <div><label className={labelCls}>Current Balance (LKR)</label><input type="number" className={inputCls} placeholder="0" value={cardForm.currentBalance} onChange={e => setCardForm(f => ({...f, currentBalance: e.target.value}))} /></div>
                  <div><label className={labelCls}>APR (%)</label><input type="number" step="0.01" className={inputCls} placeholder="28.00" value={cardForm.aprPercent} onChange={e => setCardForm(f => ({...f, aprPercent: e.target.value}))} /></div>
                  <div><label className={labelCls}>Grace Period Min (days)</label><input type="number" className={inputCls} placeholder="18" value={cardForm.graceMinDays} onChange={e => setCardForm(f => ({...f, graceMinDays: e.target.value}))} /></div>
                  <div><label className={labelCls}>Grace Period Max (days)</label><input type="number" className={inputCls} placeholder="25" value={cardForm.graceMaxDays} onChange={e => setCardForm(f => ({...f, graceMaxDays: e.target.value}))} /></div>
                  <div><label className={labelCls}>Next Due Date</label><input type="date" className={inputCls} value={cardForm.dueDate} onChange={e => setCardForm(f => ({...f, dueDate: e.target.value}))} /></div>
                  <div><label className={labelCls}>Cycle Start Day (1-28)</label><input type="number" min="1" max="28" className={inputCls} placeholder="1" value={cardForm.cycleStartDay} onChange={e => setCardForm(f => ({...f, cycleStartDay: e.target.value}))} /></div>
                </div>
                <div className="mt-4">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={cardForm.payInFullIntent} onChange={e => setCardForm(f => ({...f, payInFullIntent: e.target.checked}))} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-foreground">Pay in full every cycle</span>
                  </label>
                  {!cardForm.payInFullIntent && <p className="text-xs text-amber-500 mt-1.5 ml-6">Carry intent — shortfall warnings suppressed; APR cost shown instead.</p>}
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={() => { void handleSaveCard(); }} className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold"><Check size={14} /> {editingCard ? 'Update' : 'Save Card'}</button>
                  <button onClick={resetCardForm} className="px-4 py-2 text-muted-foreground text-xs hover:text-foreground">Cancel</button>
                </div>
              </div>
            )}
            {cards.length === 0 && !isAddingCard
              ? <p className="text-sm text-muted-foreground">No cards added yet.</p>
              : <div className="space-y-2">{cards.map(card => (
                  <div key={card.id} className={`${cardCls} p-4 flex items-center justify-between`}>
                    <div>
                      <p className="font-semibold text-foreground text-sm">{card.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">LKR {fmt(card.creditLimit)} limit · {card.aprPercent}% APR · Due {format(new Date(card.dueDate), 'MMM d')} · {card.payInFullIntent ? 'Pay in full' : 'Carry intent'}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openEditCard(card)} className="p-1.5 text-muted-foreground hover:text-foreground"><Edit2 size={13} /></button>
                      <button onClick={() => { void handleDeleteCard(card.id); }} className="p-1.5 text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}</div>
            }
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Cash Offset Sources</h3>
              <button onClick={() => setIsAddingOffset(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"><Plus size={14} /> Add Source</button>
            </div>
            {isAddingOffset && (
              <div className={`${cardCls} p-5 mb-4`}>
                <div className="flex items-center justify-between mb-4"><h4 className="text-sm font-semibold text-foreground">New Offset Source</h4><button onClick={() => setIsAddingOffset(false)}><X size={16} className="text-muted-foreground" /></button></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={labelCls}>Name</label><input className={inputCls} placeholder="Family groceries, Roommate rent..." value={offsetForm.name} onChange={e => setOffsetForm(f => ({...f, name: e.target.value}))} /></div>
                  <div><label className={labelCls}>Linked Card</label><select className={inputCls} value={offsetForm.linkedCardId} onChange={e => setOffsetForm(f => ({...f, linkedCardId: e.target.value}))}><option value="">Select card...</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <div><label className={labelCls}>Expected Monthly (LKR)</label><input type="number" className={inputCls} placeholder="25000" value={offsetForm.expectedMonthlyAmount} onChange={e => setOffsetForm(f => ({...f, expectedMonthlyAmount: e.target.value}))} /></div>
                  <div><label className={labelCls}>Category (optional)</label><input className={inputCls} placeholder="Family, Business..." value={offsetForm.category} onChange={e => setOffsetForm(f => ({...f, category: e.target.value}))} /></div>
                </div>
                <div className="flex gap-2 mt-4"><button onClick={() => { void handleSaveOffset(); }} className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold"><Check size={14} /> Save</button><button onClick={() => setIsAddingOffset(false)} className="px-4 py-2 text-muted-foreground text-xs hover:text-foreground">Cancel</button></div>
              </div>
            )}
            {offsets.length === 0 && !isAddingOffset
              ? <p className="text-sm text-muted-foreground">No offset sources yet.</p>
              : <div className="space-y-2">{offsets.map(src => { const card = cards.find(c => c.id === src.linkedCardId); return (<div key={src.id} className={`${cardCls} p-4 flex items-center justify-between`}><div><p className="font-semibold text-foreground text-sm">{src.name}</p><p className="text-xs text-muted-foreground font-mono">LKR {fmt(src.expectedMonthlyAmount)}/mo · {card?.name ?? '-'}{src.category ? ` · ${src.category}` : ''}</p></div><button onClick={() => { void handleDeleteOffset(src.id); }} className="p-1.5 text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button></div>); })}</div>
            }
          </section>

          <section>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-foreground">Fixed Deposits</h3><button onClick={() => setIsAddingFD(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"><Plus size={14} /> Add FD</button></div>
            {isAddingFD && (
              <div className={`${cardCls} p-5 mb-4`}>
                <div className="flex items-center justify-between mb-4"><h4 className="text-sm font-semibold text-foreground">New Fixed Deposit</h4><button onClick={() => setIsAddingFD(false)}><X size={16} className="text-muted-foreground" /></button></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={labelCls}>Name / Bank</label><input className={inputCls} placeholder="ComBank 12m FD" value={fdForm.name} onChange={e => setFdForm(f => ({...f, name: e.target.value}))} /></div>
                  <div><label className={labelCls}>Principal (LKR)</label><input type="number" className={inputCls} placeholder="500000" value={fdForm.principal} onChange={e => setFdForm(f => ({...f, principal: e.target.value}))} /></div>
                  <div><label className={labelCls}>Annual Rate (%)</label><input type="number" step="0.01" className={inputCls} placeholder="9.50" value={fdForm.ratePercent} onChange={e => setFdForm(f => ({...f, ratePercent: e.target.value}))} /></div>
                  <div><label className={labelCls}>Maturity (months)</label><input type="number" className={inputCls} placeholder="12" value={fdForm.maturityIntervalMonths} onChange={e => setFdForm(f => ({...f, maturityIntervalMonths: e.target.value}))} /></div>
                  <div><label className={labelCls}>Secured Against Card (optional)</label><select className={inputCls} value={fdForm.linkedCardId} onChange={e => setFdForm(f => ({...f, linkedCardId: e.target.value}))}><option value="">None</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                </div>
                <div className="flex gap-2 mt-4"><button onClick={() => { void handleSaveFD(); }} className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold"><Check size={14} /> Save FD</button><button onClick={() => setIsAddingFD(false)} className="px-4 py-2 text-muted-foreground text-xs hover:text-foreground">Cancel</button></div>
              </div>
            )}
            {fds.length === 0 && !isAddingFD
              ? <p className="text-sm text-muted-foreground">No fixed deposits yet.</p>
              : <div className="space-y-2">{fds.map(fd => { const annual = (fd.principal * fd.ratePercent) / 100; const card = cards.find(c => c.id === fd.linkedCardId); return (<div key={fd.id} className={`${cardCls} p-4 flex items-center justify-between`}><div><p className="font-semibold text-foreground text-sm">{fd.name}</p><p className="text-xs text-muted-foreground font-mono">LKR {fmt(fd.principal)} · {fd.ratePercent}% p.a. · Annual return: LKR {fmt(Math.round(annual))}{card ? ` · Secured: ${card.name}` : ''}</p></div><button onClick={() => { void handleDeleteFD(fd.id); }} className="p-1.5 text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button></div>); })}</div>
            }
          </section>

          <section>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-foreground">Money Market Accounts</h3><button onClick={() => setIsAddingMMA(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"><Plus size={14} /> Add MMA</button></div>
            {isAddingMMA && (
              <div className={`${cardCls} p-5 mb-4`}>
                <div className="flex items-center justify-between mb-4"><h4 className="text-sm font-semibold text-foreground">New Money Market Account</h4><button onClick={() => setIsAddingMMA(false)}><X size={16} className="text-muted-foreground" /></button></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={labelCls}>Account Name</label><input className={inputCls} placeholder="NDB Smart Saver" value={mmaForm.name} onChange={e => setMmaForm(f => ({...f, name: e.target.value}))} /></div>
                  <div><label className={labelCls}>Current Balance (LKR)</label><input type="number" className={inputCls} placeholder="1000000" value={mmaForm.balance} onChange={e => setMmaForm(f => ({...f, balance: e.target.value}))} /></div>
                  <div><label className={labelCls}>Current Rate (%)</label><input type="number" step="0.01" className={inputCls} placeholder="8.00" value={mmaForm.currentRatePercent} onChange={e => setMmaForm(f => ({...f, currentRatePercent: e.target.value}))} /></div>
                  <div><label className={labelCls}>Minimum Balance for Rate (LKR)</label><input type="number" className={inputCls} placeholder="500000" value={mmaForm.minimumBalanceForRate} onChange={e => setMmaForm(f => ({...f, minimumBalanceForRate: e.target.value}))} /></div>
                  <div><label className={labelCls}>Base Rate Below Minimum (%)</label><input type="number" step="0.01" className={inputCls} placeholder="3.50" value={mmaForm.baseRatePercent} onChange={e => setMmaForm(f => ({...f, baseRatePercent: e.target.value}))} /></div>
                </div>
                <div className="flex gap-2 mt-4"><button onClick={() => { void handleSaveMMA(); }} className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold"><Check size={14} /> Save MMA</button><button onClick={() => setIsAddingMMA(false)} className="px-4 py-2 text-muted-foreground text-xs hover:text-foreground">Cancel</button></div>
              </div>
            )}
            {mmas.length === 0 && !isAddingMMA
              ? <p className="text-sm text-muted-foreground">No money market accounts yet.</p>
              : <div className="space-y-2">{mmas.map(mma => { const eff = mma.balance >= mma.minimumBalanceForRate ? mma.currentRatePercent : mma.baseRatePercent; const annual = (mma.balance * eff) / 100; const below = mma.balance < mma.minimumBalanceForRate; return (<div key={mma.id} className={`${cardCls} p-4 flex items-center justify-between`}><div><p className="font-semibold text-foreground text-sm">{mma.name}</p><p className="text-xs text-muted-foreground font-mono">LKR {fmt(mma.balance)} · {eff}% effective · Annual: LKR {fmt(Math.round(annual))}</p>{below && <p className="text-[11px] text-amber-500 mt-0.5">Below minimum — base rate {mma.baseRatePercent}%</p>}</div><button onClick={() => { void handleDeleteMMA(mma.id); }} className="p-1.5 text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button></div>); })}</div>
            }
          </section>

          <section>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-foreground">Installment Plans</h3><button onClick={() => setIsAddingPlan(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"><Plus size={14} /> Add Plan</button></div>
            {isAddingPlan && (
              <div className={`${cardCls} p-5 mb-4`}>
                <div className="flex items-center justify-between mb-4"><h4 className="text-sm font-semibold text-foreground">New Installment Plan</h4><button onClick={() => setIsAddingPlan(false)}><X size={16} className="text-muted-foreground" /></button></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={labelCls}>Description</label><input className={inputCls} placeholder="MacBook Pro 14" value={planForm.description} onChange={e => setPlanForm(f => ({...f, description: e.target.value}))} /></div>
                  <div><label className={labelCls}>Linked Card</label><select className={inputCls} value={planForm.linkedCardId} onChange={e => setPlanForm(f => ({...f, linkedCardId: e.target.value}))}><option value="">Select card...</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <div><label className={labelCls}>Total Amount (LKR)</label><input type="number" className={inputCls} placeholder="300000" value={planForm.totalAmount} onChange={e => setPlanForm(f => ({...f, totalAmount: e.target.value}))} /></div>
                  <div><label className={labelCls}>Monthly Amount (LKR)</label><input type="number" className={inputCls} placeholder="12500" value={planForm.monthlyAmount} onChange={e => setPlanForm(f => ({...f, monthlyAmount: e.target.value}))} /></div>
                  <div><label className={labelCls}>Total Months</label><input type="number" className={inputCls} placeholder="24" value={planForm.totalMonths} onChange={e => setPlanForm(f => ({...f, totalMonths: e.target.value}))} /></div>
                  <div><label className={labelCls}>Months Already Paid</label><input type="number" className={inputCls} placeholder="0" value={planForm.monthsPaid} onChange={e => setPlanForm(f => ({...f, monthsPaid: e.target.value}))} /></div>
                </div>
                <div className="flex gap-2 mt-4"><button onClick={() => { void handleSavePlan(); }} className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold"><Check size={14} /> Save Plan</button><button onClick={() => setIsAddingPlan(false)} className="px-4 py-2 text-muted-foreground text-xs hover:text-foreground">Cancel</button></div>
              </div>
            )}
            {plans.length === 0 && !isAddingPlan
              ? <p className="text-sm text-muted-foreground">No installment plans yet.</p>
              : <div className="space-y-2">{plans.map(plan => { const card = cards.find(c => c.id === plan.linkedCardId); const pct = plan.totalMonths > 0 ? (plan.monthsPaid / plan.totalMonths) * 100 : 0; const done = !plan.active && plan.monthsPaid >= plan.totalMonths; return (<div key={plan.id} className={`${cardCls} p-4`}><div className="flex items-start justify-between mb-2"><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><p className="font-semibold text-foreground text-sm truncate">{plan.description}</p>{done && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 rounded font-semibold shrink-0">Done</span>}</div><p className="text-xs text-muted-foreground font-mono">{card?.name ?? '-'} · LKR {fmt(plan.monthlyAmount)}/mo · {plan.monthsPaid}/{plan.totalMonths} paid</p></div><div className="flex items-center gap-1.5 ml-3 shrink-0">{plan.active && <button onClick={() => { void handleMarkPlanPaid(plan); }} className="text-xs px-2.5 py-1 bg-muted text-foreground rounded-lg hover:bg-muted/70 font-medium">Mark Paid</button>}<button onClick={() => { void handleDeletePlan(plan.id); }} className="p-1.5 text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button></div></div><div className="h-1 bg-muted rounded-full overflow-hidden"><div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} /></div></div>); })}</div>
            }
          </section>

          <section>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-foreground">Cashback / Promo Tracker</h3><button onClick={() => setIsAddingPromo(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"><Plus size={14} /> Add Promo</button></div>
            {isAddingPromo && (
              <div className={`${cardCls} p-5 mb-4`}>
                <div className="flex items-center justify-between mb-4"><h4 className="text-sm font-semibold text-foreground">New Promo</h4><button onClick={() => setIsAddingPromo(false)}><X size={16} className="text-muted-foreground" /></button></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={labelCls}>Description</label><input className={inputCls} placeholder="Sep Cashback Offer" value={promoForm.description} onChange={e => setPromoForm(f => ({...f, description: e.target.value}))} /></div>
                  <div><label className={labelCls}>Linked Card</label><select className={inputCls} value={promoForm.linkedCardId} onChange={e => setPromoForm(f => ({...f, linkedCardId: e.target.value}))}><option value="">Select card...</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <div><label className={labelCls}>Spend Threshold (LKR)</label><input type="number" className={inputCls} placeholder="50000" value={promoForm.spendThreshold} onChange={e => setPromoForm(f => ({...f, spendThreshold: e.target.value}))} /></div>
                  <div><label className={labelCls}>Min Transaction Count</label><input type="number" className={inputCls} placeholder="10" value={promoForm.minTransactionCount} onChange={e => setPromoForm(f => ({...f, minTransactionCount: e.target.value}))} /></div>
                  <div><label className={labelCls}>Window Start</label><input type="date" className={inputCls} value={promoForm.windowStart} onChange={e => setPromoForm(f => ({...f, windowStart: e.target.value}))} /></div>
                  <div><label className={labelCls}>Window End</label><input type="date" className={inputCls} value={promoForm.windowEnd} onChange={e => setPromoForm(f => ({...f, windowEnd: e.target.value}))} /></div>
                  <div><label className={labelCls}>Cashback %</label><input type="number" step="0.01" className={inputCls} placeholder="5" value={promoForm.cashbackPercent} onChange={e => setPromoForm(f => ({...f, cashbackPercent: e.target.value}))} /></div>
                  <div><label className={labelCls}>Cashback Cap (LKR)</label><input type="number" className={inputCls} placeholder="5000" value={promoForm.cashbackCap} onChange={e => setPromoForm(f => ({...f, cashbackCap: e.target.value}))} /></div>
                  <div><label className={labelCls}>Current Spend (LKR)</label><input type="number" className={inputCls} placeholder="0" value={promoForm.currentSpend} onChange={e => setPromoForm(f => ({...f, currentSpend: e.target.value}))} /></div>
                  <div><label className={labelCls}>Current Transaction Count</label><input type="number" className={inputCls} placeholder="0" value={promoForm.currentTransactionCount} onChange={e => setPromoForm(f => ({...f, currentTransactionCount: e.target.value}))} /></div>
                </div>
                <div className="flex gap-2 mt-4"><button onClick={() => { void handleSavePromo(); }} className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold"><Check size={14} /> Save Promo</button><button onClick={() => setIsAddingPromo(false)} className="px-4 py-2 text-muted-foreground text-xs hover:text-foreground">Cancel</button></div>
              </div>
            )}
            {promos.length === 0 && !isAddingPromo
              ? <p className="text-sm text-muted-foreground">No promos yet.</p>
              : <div className="space-y-3">{promos.map(promo => { const card = cards.find(c => c.id === promo.linkedCardId); const expired = promo.windowEnd <= Date.now(); const dl = differenceInDays(new Date(promo.windowEnd), new Date()); return (<div key={promo.id} className={`${cardCls} p-4 ${expired ? 'opacity-60' : ''}`}><div className="flex items-start justify-between mb-3"><div><div className="flex items-center gap-2"><p className="font-semibold text-foreground text-sm">{promo.description}</p>{expired && <span className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded">Expired</span>}</div><p className="text-xs text-muted-foreground">{card?.name ?? '-'} · {expired ? 'Ended' : `${dl}d left`} · {promo.cashbackPercent}% back (cap LKR {fmt(promo.cashbackCap)})</p></div><button onClick={() => { void handleDeletePromo(promo.id); }} className="p-1.5 text-muted-foreground hover:text-red-500 shrink-0 ml-2"><Trash2 size={13} /></button></div><div className="grid grid-cols-2 gap-3"><div><label className={labelCls}>Current Spend (LKR)</label><input type="number" className={inputCls} value={promo.currentSpend} onChange={e => { void handleUpdatePromoProgress(promo, 'currentSpend', e.target.value); }} /></div><div><label className={labelCls}>Transaction Count</label><input type="number" className={inputCls} value={promo.currentTransactionCount} onChange={e => { void handleUpdatePromoProgress(promo, 'currentTransactionCount', e.target.value); }} /></div></div></div>); })}</div>
            }
          </section>
        </div>
      )}

      {/* FLOAT GAP */}
      {activeTab === 'gap' && (
        <div className="space-y-6">
          {cards.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">Add credit cards first to track float gap history.</p>
              <button onClick={() => setActiveTab('cards')} className="mt-3 text-xs text-accent font-semibold underline">Go to Cards & Sources</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground shrink-0">Card:</span>
                {cards.map(c => (
                  <button key={c.id} onClick={() => setSelectedCardId(c.id)} className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${resolvedCardId === c.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{c.name}</button>
                ))}
              </div>

              {(() => {
                const exposure    = getCardExposure(resolvedCardId, gapHistory);
                const card        = cards.find(c => c.id === resolvedCardId);
                const cardOffsets = offsets.filter(o => o.linkedCardId === resolvedCardId);
                return (
                  <div className={`${cardCls} p-5`}>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Current Exposure — {card?.name}</p>
                    <p className={`font-mono text-2xl font-semibold ${exposure < 0 ? 'text-red-500' : exposure > 0 ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                      {exposure < 0 ? '-' : exposure > 0 ? '+' : ''}LKR {fmt(exposure)}{' '}
                      <span className="text-sm font-normal text-muted-foreground">{exposure < 0 ? 'gap (exposure)' : exposure > 0 ? 'ahead' : '(no history yet)'}</span>
                    </p>
                    {cardOffsets.length > 0 && <p className="text-xs text-muted-foreground mt-2">Offset sources: {cardOffsets.map(o => `${o.name} (LKR ${fmt(o.expectedMonthlyAmount)}/mo)`).join(' · ')}</p>}
                  </div>
                );
              })()}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">Cycle History</h3>
                  <button onClick={() => setIsAddingGap(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"><Plus size={14} /> Log Cycle</button>
                </div>
                {isAddingGap && (
                  <div className={`${cardCls} p-5 mb-4`}>
                    <div className="flex items-center justify-between mb-4"><h4 className="text-sm font-semibold text-foreground">Log Cycle Entry</h4><button onClick={() => setIsAddingGap(false)}><X size={16} className="text-muted-foreground" /></button></div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div><label className={labelCls}>Cycle Label (YYYY-MM)</label><input className={inputCls} placeholder="2026-09" value={gapForm.cycleLabel} onChange={e => setGapForm(f => ({...f, cycleLabel: e.target.value}))} /></div>
                      <div><label className={labelCls}>Total Card Bill (LKR)</label><input type="number" className={inputCls} placeholder="25000" value={gapForm.totalBill} onChange={e => setGapForm(f => ({...f, totalBill: e.target.value}))} /></div>
                      <div><label className={labelCls}>Cash Received (LKR)</label><input type="number" className={inputCls} placeholder="25000" value={gapForm.cashReceived} onChange={e => setGapForm(f => ({...f, cashReceived: e.target.value}))} /></div>
                    </div>
                    {gapForm.totalBill && gapForm.cashReceived && (
                      <p className={`text-xs mt-2 font-mono ${parseFloat(gapForm.cashReceived) - parseFloat(gapForm.totalBill) < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                        Cycle delta: {parseFloat(gapForm.cashReceived) - parseFloat(gapForm.totalBill) >= 0 ? '+' : ''}LKR {fmt(Math.round(parseFloat(gapForm.cashReceived) - parseFloat(gapForm.totalBill)))}
                      </p>
                    )}
                    <div className="flex gap-2 mt-4"><button onClick={() => { void handleAddGapEntry(); }} className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold"><Check size={14} /> Add Entry</button><button onClick={() => setIsAddingGap(false)} className="px-4 py-2 text-muted-foreground text-xs hover:text-foreground">Cancel</button></div>
                  </div>
                )}
                {selectedCardHistory.length > 0
                  ? <div className={`${cardCls} divide-y divide-border`}>{[...selectedCardHistory].reverse().map(entry => (<div key={entry.id} className="flex items-center justify-between p-4"><div><p className="font-mono font-semibold text-foreground text-sm">{entry.cycleLabel}</p><p className="text-xs text-muted-foreground font-mono">Bill: {fmt(entry.totalBill)} · In: {fmt(entry.cashReceived)} · Delta: <span className={entry.delta < 0 ? 'text-red-400' : 'text-emerald-400'}>{entry.delta < 0 ? '-' : '+'}LKR {fmt(entry.delta)}</span></p></div><div className="flex items-center gap-3"><p className={`font-mono font-semibold text-sm ${entry.cumulativeGap < 0 ? 'text-red-500' : 'text-foreground'}`}>Σ {entry.cumulativeGap < 0 ? '-' : '+'}LKR {fmt(entry.cumulativeGap)}</p><button onClick={() => { void handleDeleteGapEntry(entry); }} className="p-1 text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button></div></div>))}</div>
                  : <p className="text-sm text-muted-foreground">No cycle entries yet for this card.</p>
                }
              </div>

              {selectedCardHistory.length >= 2 && (
                <div className={cardCls}>
                  <div className="p-4 border-b border-border"><p className="text-sm font-semibold text-foreground">Gap Trend</p><p className="text-xs text-muted-foreground">Cumulative float gap — negative = unrecovered exposure</p></div>
                  <div className="p-4"><GapTrendChart history={selectedCardHistory} /></div>
                </div>
              )}

              {completedPlans.filter(p => p.linkedCardId === resolvedCardId).map(plan => {
                const exposure = Math.abs(getCardExposure(resolvedCardId, gapHistory));
                if (exposure === 0) return null;
                return (
                  <div key={plan.id} className={`${cardCls} p-5`}>
                    <p className="text-sm font-semibold text-foreground mb-4">Payoff Simulator</p>
                    <PayoffSimulator gapAmount={exposure} monthlyAmount={plan.monthlyAmount} planName={plan.description} />
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* LEDGERS */}
      {activeTab === 'ledgers' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap gap-2">
              {ledgers.map(l => (<button key={l.id} onClick={() => setSelectedLedgerId(l.id)} className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${resolvedLedgerId === l.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{l.counterpartyName}</button>))}
            </div>
            <button onClick={() => setIsAddingLedger(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80 shrink-0"><Plus size={14} /> New Ledger</button>
          </div>

          {isAddingLedger && (
            <div className={`${cardCls} p-5`}>
              <h4 className="text-sm font-semibold text-foreground mb-3">New Reimbursement Ledger</h4>
              <div className="flex gap-3">
                <input className={`${inputCls} flex-1`} placeholder="Counterparty name (Dad, Roommate, Business partner...)" value={newLedgerName} onChange={e => setNewLedgerName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void handleAddLedger(); }} autoFocus />
                <button onClick={() => { void handleAddLedger(); }} className="px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold shrink-0">Create</button>
                <button onClick={() => { setIsAddingLedger(false); setNewLedgerName(''); }} className="px-3 text-muted-foreground text-xs hover:text-foreground">Cancel</button>
              </div>
            </div>
          )}

          {ledgers.length === 0 && !isAddingLedger ? (
            <div className="text-center py-16">
              <BookOpen size={44} className="mx-auto text-muted-foreground opacity-20 mb-4" />
              <p className="text-sm font-medium text-foreground mb-1">No reimbursement ledgers yet</p>
              <p className="text-xs text-muted-foreground mb-5 max-w-xs mx-auto">Create a ledger for each counterparty — track what they owe you and what you have received over time.</p>
              <button onClick={() => setIsAddingLedger(true)} className="px-4 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-semibold">New Ledger</button>
            </div>
          ) : resolvedLedgerId ? (() => {
            const ledger  = ledgers.find(l => l.id === resolvedLedgerId);
            if (!ledger) return null;
            const balance = getLedgerBalance(selectedLedgerEntries);
            const trend   = getLedgerTrend(selectedLedgerEntries);
            const pos     = balance > 0;
            return (
              <div className="space-y-5">
                <div className={`${cardCls} p-5`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{ledger.counterpartyName}</p>
                      {balance === 0
                        ? <p className="font-mono text-xl font-semibold text-muted-foreground">Settled — LKR 0 either way</p>
                        : <>
                            <p className={`font-mono text-3xl font-semibold ${pos ? 'text-emerald-500' : 'text-red-500'}`}>LKR {fmt(Math.abs(balance))}</p>
                            <p className="text-sm text-muted-foreground mt-1">{pos ? `${ledger.counterpartyName} currently owes you LKR ${fmt(balance)}` : `You currently owe ${ledger.counterpartyName} LKR ${fmt(Math.abs(balance))}`}</p>
                          </>
                      }
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-1 text-xs">
                        {trend === 'growing'  && <><TrendingUp  size={13} className="text-emerald-500" /><span className="text-emerald-500">Growing</span></>}
                        {trend === 'shrinking' && <><TrendingDown size={13} className="text-red-400" /><span className="text-red-400">Shrinking</span></>}
                        {trend === 'stable'   && <><MinusIcon   size={13} className="text-muted-foreground" /><span className="text-muted-foreground">Stable</span></>}
                      </div>
                      <button onClick={() => { void handleDeleteLedger(ledger); }} className="text-[11px] text-red-400 hover:text-red-500">Delete ledger</button>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground">Entry History</h3>
                    <button onClick={() => setIsAddingEntry(true)} className="flex items-center gap-1 text-xs text-accent font-semibold hover:opacity-80"><Plus size={14} /> Add Entry</button>
                  </div>
                  {isAddingEntry && (
                    <div className={`${cardCls} p-5 mb-4`}>
                      <div className="flex items-center justify-between mb-4"><h4 className="text-sm font-semibold text-foreground">New Entry</h4><button onClick={() => setIsAddingEntry(false)}><X size={16} className="text-muted-foreground" /></button></div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2"><label className={labelCls}>Note</label><input className={inputCls} placeholder="Groceries July, Shared utility bill..." value={entryForm.note} onChange={e => setEntryForm(f => ({...f, note: e.target.value}))} /></div>
                        <div><label className={labelCls}>Amount Owed to You (LKR)</label><input type="number" className={inputCls} placeholder="10000" value={entryForm.amountOwed} onChange={e => setEntryForm(f => ({...f, amountOwed: e.target.value}))} /></div>
                        <div><label className={labelCls}>Amount Received (LKR)</label><input type="number" className={inputCls} placeholder="10000" value={entryForm.amountPaid} onChange={e => setEntryForm(f => ({...f, amountPaid: e.target.value}))} /></div>
                        <div><label className={labelCls}>Date</label><input type="date" className={inputCls} value={entryForm.dateStr} onChange={e => setEntryForm(f => ({...f, dateStr: e.target.value}))} /></div>
                      </div>
                      {entryForm.amountOwed && entryForm.amountPaid && (
                        <p className={`text-xs mt-2 font-mono ${parseFloat(entryForm.amountPaid) - parseFloat(entryForm.amountOwed) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                          Delta: {parseFloat(entryForm.amountPaid) - parseFloat(entryForm.amountOwed) >= 0 ? '+' : ''}LKR {fmt(Math.round(parseFloat(entryForm.amountPaid) - parseFloat(entryForm.amountOwed)))}
                          {' '}({parseFloat(entryForm.amountPaid) >= parseFloat(entryForm.amountOwed) ? `${ledger.counterpartyName} overpaid` : `${ledger.counterpartyName} underpaid`})
                        </p>
                      )}
                      <div className="flex gap-2 mt-4"><button onClick={() => { void handleAddEntry(); }} className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-xl text-xs font-semibold"><Check size={14} /> Add Entry</button><button onClick={() => setIsAddingEntry(false)} className="px-4 py-2 text-muted-foreground text-xs hover:text-foreground">Cancel</button></div>
                    </div>
                  )}
                  {selectedLedgerEntries.length === 0
                    ? <p className="text-sm text-muted-foreground">No entries yet.</p>
                    : <div className={`${cardCls} divide-y divide-border`}>{[...selectedLedgerEntries].reverse().map(entry => (<div key={entry.id} className="flex items-center justify-between p-4"><div><p className="font-medium text-foreground text-sm">{entry.note}</p><p className="text-xs text-muted-foreground font-mono mt-0.5">{format(new Date(entry.date), 'MMM d, yyyy')} · Owed: LKR {fmt(entry.amountOwed)} · Received: LKR {fmt(entry.amountPaid)}</p></div><div className="flex items-center gap-3"><p className={`font-mono font-semibold text-sm ${entry.delta >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>{entry.delta >= 0 ? '+' : '-'}LKR {fmt(Math.abs(entry.delta))}</p><button onClick={() => { void handleDeleteEntry(entry.id); }} className="p-1 text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button></div></div>))}</div>
                  }
                </div>
              </div>
            );
          })() : null}
        </div>
      )}

      {/* INTEREST */}
      {activeTab === 'interest' && (
        <div className="space-y-6">
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs text-amber-700 dark:text-amber-400 space-y-1.5">
            <p className="font-semibold">Honest framing</p>
            <p>This tool answers one specific question: is it worth breaking an FD or MMA to cover a card shortfall? The honest answer is almost always no — your card APR is dramatically higher than your FD or MMA yield. The default for all cards is &quot;pay in full.&quot; This comparator makes that conclusion legible, not a rationalization for carrying a balance.</p>
          </div>

          {cards.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground shrink-0">Card:</span>
              {cards.map(c => (<button key={c.id} onClick={() => setInterestCardId(c.id)} className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${resolvedInterestCardId === c.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{c.name}</button>))}
            </div>
          )}

          {interestCard ? (
            <div className="space-y-4">
              <div className={`${cardCls} p-5`}>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">{interestCard.name} — APR Cost if Balance Carried</p>
                <div className="grid grid-cols-3 gap-4">
                  <div><p className="text-xs text-muted-foreground">Current Balance</p><p className="font-mono font-semibold text-foreground mt-0.5">LKR {fmt(interestCard.currentBalance)}</p></div>
                  <div><p className="text-xs text-muted-foreground">APR</p><p className="font-mono font-semibold text-red-500 mt-0.5">{interestCard.aprPercent}%</p></div>
                  <div><p className="text-xs text-muted-foreground">Monthly APR Cost</p><p className="font-mono font-semibold text-red-500 mt-0.5">LKR {fmt(Math.round((interestCard.currentBalance * interestCard.aprPercent) / 100 / 12))}</p></div>
                </div>
                {!interestCard.payInFullIntent && <p className="text-xs text-amber-500 mt-3 font-medium">This card is in carry-intent mode — the APR cost above is a real ongoing expense.</p>}
                {interestCard.payInFullIntent && interestCard.currentBalance === 0 && <p className="text-xs text-emerald-500 mt-3">Balance is zero — no APR exposure.</p>}
              </div>

              {fds.length > 0 && (
                <div className={`${cardCls} p-5`}>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Fixed Deposits — Annual Return</p>
                  <div className="space-y-3">
                    {fds.map(fd => {
                      const mr = (fd.principal * fd.ratePercent) / 100 / 12;
                      const mc = (interestCard.currentBalance * interestCard.aprPercent) / 100 / 12;
                      const fdWins = interestCard.currentBalance > 0 && mr > mc;
                      return (
                        <div key={fd.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                          <div>
                            <p className="font-semibold text-foreground text-sm">{fd.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">LKR {fmt(fd.principal)} · {fd.ratePercent}% p.a.</p>
                            {fd.linkedCardId === interestCard.id && <p className="text-[11px] text-amber-500 mt-0.5">Secured against this card</p>}
                          </div>
                          <div className="text-right">
                            <p className="font-mono font-semibold text-emerald-500 text-sm">+LKR {fmt(Math.round(mr))}/mo</p>
                            {interestCard.currentBalance > 0 && <p className={`text-[11px] mt-0.5 ${fdWins ? 'text-emerald-500' : 'text-red-400'}`}>{fdWins ? 'FD earns more (rare edge case)' : 'Card costs more — do not break FD'}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {mmas.length > 0 && (
                <div className={`${cardCls} p-5`}>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Money Market Accounts — Return</p>
                  <div className="space-y-3">
                    {mmas.map(mma => {
                      const eff  = mma.balance >= mma.minimumBalanceForRate ? mma.currentRatePercent : mma.baseRatePercent;
                      const mr   = (mma.balance * eff) / 100 / 12;
                      const mc   = (interestCard.currentBalance * interestCard.aprPercent) / 100 / 12;
                      const mmaWins = interestCard.currentBalance > 0 && mr > mc;
                      const below = mma.balance < mma.minimumBalanceForRate;
                      return (
                        <div key={mma.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                          <div>
                            <p className="font-semibold text-foreground text-sm">{mma.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">LKR {fmt(mma.balance)} · {eff}% effective</p>
                            {below && <p className="text-[11px] text-amber-500 mt-0.5">Below minimum — earning base rate</p>}
                          </div>
                          <div className="text-right">
                            <p className="font-mono font-semibold text-emerald-500 text-sm">+LKR {fmt(Math.round(mr))}/mo</p>
                            {interestCard.currentBalance > 0 && <p className={`text-[11px] mt-0.5 ${mmaWins ? 'text-emerald-500' : 'text-red-400'}`}>{mmaWins ? 'MMA earns more (rare edge case)' : 'Card costs more — pay the card'}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {linkedFD && <p className="text-xs text-muted-foreground">Note: <span className="font-semibold">{linkedFD.name}</span> is secured against {interestCard.name} — breaking it also affects card security.</p>}
              {fds.length === 0 && mmas.length === 0 && <p className="text-sm text-muted-foreground">Add Fixed Deposits or Money Market Accounts in Cards &amp; Sources to see comparisons.</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Add credit cards first to use the interest comparator.</p>
          )}
        </div>
      )}
    </div>
  );
}

