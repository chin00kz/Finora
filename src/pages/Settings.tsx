import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Trash2, Edit2, Check, X, Merge, Moon, Sun, Monitor, LogOut, UserX, CloudUpload, RefreshCw, Download, CheckCircle, Plus, FileSpreadsheet, UploadCloud, CreditCard, SlidersHorizontal, FileJson, Sparkles, Eye, EyeOff, FileText } from 'lucide-react';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useNavStore } from '../store/navStore';
import { usePrivacyStore } from '../store/privacyStore';
import { syncAll, hydrateFromCloud, triggerSync, deleteFromCloud, purgeAndRepushCloud } from '../sync/syncEngine';
import { useNavigate } from 'react-router-dom';
import ExportReportModal from '../components/ExportReportModal';
import ImportDataModal from '../components/ImportDataModal';
import MonthlyDigestModal from '../components/MonthlyDigestModal';
import {
  buildRecoveryKit,
  downloadRecoveryKit,
  executeReplaceAllLocalOnly,
  exportFullBackupJSON,
  planReplaceAllRestore,
  REPLACE_CONFIRMATION_PHRASE,
  restoreFullBackupJSON,
  type ReplaceAllRestorePlan,
} from '../utils/jsonBackup';
import {
  getPersonalFinanceEditBlockError,
  isPersonalFinanceEditFrozen,
  isRestoreIsolated,
} from '../sync/restoreIsolation';
import {
  buildReconciliationPreview,
  cancelReconciliationPreview,
  choiceAUnavailableReason,
  executeChoiceBUseCloud,
  isChoiceAAvailable,
  USE_CLOUD_CONFIRMATION_PHRASE,
  type ReconciliationPreview,
} from '../sync/cloudReconciliation';
import {
  buildOutboxReviewRows,
  type OutboxReviewRow,
} from '../sync/outboxQuarantine';
import Logo from '../components/Logo';
import { createId } from '../utils/createId';
import { useConfirm } from '../components/ConfirmDialog';
import FinoraProfileWidget from '../components/FinoraProfileWidget';
import NotificationBell from '../components/NotificationBell';

export default function Settings() {
  const { confirmDialog, requestConfirm } = useConfirm();
  const navigate = useNavigate();
  const tags = useLiveQuery(() => db.tags.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const { theme, setTheme } = useThemeStore();
  const { user, lastSyncedAt, signOut, deleteAccountData } = useAuthStore();
  const { setCustomizeModalOpen } = useNavStore();
  const {
    isMasked,
    toggleMask,
    showSafeToSpendHome,
    setShowSafeToSpendHome,
    safeToSpendForecastDays,
    setSafeToSpendForecastDays,
    oneTapLogMode,
    setOneTapLogMode,
    glanceBudget,
    setGlanceBudget,
    glanceTransactions,
    setGlanceTransactions,
    glanceUpcoming,
    setGlanceUpcoming,
  } = usePrivacyStore();

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isRestoringJson, setIsRestoringJson] = useState(false);
  const [replaceAllPlan, setReplaceAllPlan] = useState<ReplaceAllRestorePlan | null>(null);
  const [replaceBackupJson, setReplaceBackupJson] = useState<string | null>(null);
  const [replaceConfirmText, setReplaceConfirmText] = useState('');
  const [recoveryKitSaved, setRecoveryKitSaved] = useState(false);
  const [isPreparingRecovery, setIsPreparingRecovery] = useState(false);
  const [isExecutingReplace, setIsExecutingReplace] = useState(false);
  const [isDigestModalOpen, setIsDigestModalOpen] = useState(false);
  const cloudSyncIsolated = isRestoreIsolated();
  const personalEditsFrozen = isPersonalFinanceEditFrozen();

  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [reconcilePreview, setReconcilePreview] = useState<ReconciliationPreview | null>(null);
  const [useCloudConfirmText, setUseCloudConfirmText] = useState('');
  const [isApplyingChoiceB, setIsApplyingChoiceB] = useState(false);
  const [outboxReviewRows, setOutboxReviewRows] = useState<OutboxReviewRow[]>([]);

  const quarantinedOutbox = useLiveQuery(async () => {
    const all = await db.pendingAccountOutbox.toArray();
    return all.filter(e => e.quarantinedAt != null);
  }) || [];

  useEffect(() => {
    let cancelled = false;
    void buildOutboxReviewRows({ quarantinedOnly: true }).then(rows => {
      if (!cancelled) setOutboxReviewRows(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [quarantinedOutbox.length, quarantinedOutbox.map(e => e.id).join(',')]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [targetMergeId, setTargetMergeId] = useState('');



  const handleEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
    setMergingId(null);
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    const editBlock = getPersonalFinanceEditBlockError();
    if (editBlock) {
      setSyncFeedback({ message: editBlock.message, isError: true });
      return;
    }
    await db.tags.update(id, { name: editName.trim(), updatedAt: Date.now() });
    setEditingId(null);
    triggerSync('tags', id);
  };

  const handleDelete = async (id: string) => {
    const ok = await requestConfirm({
      title: 'Delete this tag?',
      body: 'It will be removed from all transactions.',
      danger: true,
    });
    if (!ok) return;
    let updatedTxnIds: string[] = [];
    await db.transaction('rw', db.tags, db.transactions, async () => {
      const txns = await db.transactions.filter(t => !!t.tagIds && t.tagIds.includes(id)).toArray();
      updatedTxnIds = txns.map(t => t.id);
      for (const txn of txns) {
        if (txn.tagIds) {
          await db.transactions.update(txn.id, {
            tagIds: txn.tagIds.filter(tid => tid !== id),
            updatedAt: Date.now()
          });
        }
      }
      await db.tags.delete(id);
    });
    await deleteFromCloud('tags', id);
    updatedTxnIds.forEach(txnId => triggerSync('transactions', txnId));
  };

  const handleMerge = async (sourceId: string) => {
    if (!targetMergeId || targetMergeId === sourceId) return;
    
    const ok = await requestConfirm({
      title: 'Merge these tags?',
      body: 'This will re-tag all transactions and delete the source tag.',
      danger: true,
    });
    if (!ok) return;

    let updatedTxnIds: string[] = [];
    await db.transaction('rw', db.tags, db.transactions, async () => {
      const txns = await db.transactions.filter(t => !!t.tagIds && t.tagIds.includes(sourceId)).toArray();
      updatedTxnIds = txns.map(t => t.id);
      for (const txn of txns) {
        if (txn.tagIds) {
          const newTags = new Set(txn.tagIds.filter(tid => tid !== sourceId));
          newTags.add(targetMergeId);
          await db.transactions.update(txn.id, { 
            tagIds: Array.from(newTags),
            updatedAt: Date.now()
          });
        }
      }
      await db.tags.delete(sourceId);
    });
    await deleteFromCloud('tags', sourceId);
    updatedTxnIds.forEach(txnId => triggerSync('transactions', txnId));
    setMergingId(null);
    setTargetMergeId('');
  };

  // ── Category management ──────────────────────────────────────────────────────
  const PRESET_COLORS = ['#f43f5e', '#f97316', '#eab308', '#22c55e', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'expense' | 'income'>('expense');
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [showAddCat, setShowAddCat] = useState(false);
  const [catError, setCatError] = useState('');

  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatError, setEditCatError] = useState('');

  const handleAddCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    const duplicate = categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.type === newCatType);
    if (duplicate) {
      setCatError(`A ${newCatType} category named "${name}" already exists.`);
      return;
    }
    setCatError('');
    const id = createId('cat');
    await db.categories.add({ id, name, type: newCatType, icon: 'tag', color: newCatColor, updatedAt: Date.now() });
    triggerSync('categories', id);
    setNewCatName('');
    setShowAddCat(false);
  };

  const handleRenameCategory = async (id: string) => {
    const name = editCatName.trim();
    if (!name) return;
    const cat = categories.find(c => c.id === id);
    const duplicate = categories.find(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase() && c.type === cat?.type);
    if (duplicate) {
      setEditCatError(`A ${cat?.type} category named "${name}" already exists.`);
      return;
    }
    setEditCatError('');
    await db.categories.update(id, { name, updatedAt: Date.now() });
    triggerSync('categories', id);
    setEditingCatId(null);
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    const ok = await requestConfirm({
      title: `Delete the "${name}" category?`,
      body: 'Transactions using it will have no category.',
      danger: true,
    });
    if (!ok) return;
    await db.transaction('rw', db.categories, db.transactions, async () => {
      await db.transactions.filter(t => t.categoryId === id).modify({ categoryId: undefined });
      await db.categories.delete(id);
    });
    await deleteFromCloud('categories', id);
  };

  return (
    <div className="p-6 pb-28 max-w-5xl mx-auto">
      {confirmDialog}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-medium text-foreground">Settings</h2>
        <NotificationBell />
      </div>

      {/* ── Account ─────────────────────────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-6">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Account & Cloud Sync</h3>
          <p className="text-xs text-muted-foreground mt-1">Automatic two-way cloud backup across devices.</p>
        </div>

          <FinoraProfileWidget />
        {user ? (
          <div className="p-5 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Account</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{user.email}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Last synced: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Pending sync'}
              </p>
            </div>

            {/* Sync Feedback Message */}
            {syncFeedback && (
              <div className={`flex items-start gap-2 p-3 rounded-xl text-xs font-medium ${
                syncFeedback.isError
                  ? 'bg-red-500/10 border border-red-500/20 text-red-500'
                  : 'bg-green-500/10 border border-green-500/20 text-green-600'
              }`}>
                <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span className="break-all">{syncFeedback.message}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={async () => {
                  setIsSyncing(true);
                  setSyncFeedback(null);
                  const res = await syncAll(user.id);
                  setIsSyncing(false);
                  if (res.success) {
                    setSyncFeedback({ message: 'Two-way sync complete!', isError: false });
                  } else {
                    setSyncFeedback({ message: res.error || 'Sync encountered an error.', isError: true });
                  }
                }}
                disabled={isSyncing || cloudSyncIsolated}
                className="flex items-center justify-center gap-2 py-2.5 px-3 bg-accent text-accent-foreground rounded-xl text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-60"
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                {cloudSyncIsolated ? 'Sync isolated' : isSyncing ? 'Syncing…' : 'Sync Now'}
              </button>

              <button
                onClick={async () => {
                  setIsSyncing(true);
                  setSyncFeedback(null);
                  const res = await hydrateFromCloud(user.id);
                  setIsSyncing(false);
                  setSyncFeedback({
                    message: `Restored ${res.restoredCount} items from cloud.`,
                    isError: false
                  });
                }}
                disabled={isSyncing || cloudSyncIsolated}
                className="flex items-center justify-center gap-2 py-2.5 px-3 bg-muted text-foreground rounded-xl text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-60"
              >
                <Download size={14} />
                Pull Cloud Data
              </button>
            </div>
            {cloudSyncIsolated && (
              <div className="space-y-3 pt-2 border-t border-border">
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                  Local-only restored isolation is active. Cloud sync is blocked.
                  {personalEditsFrozen
                    ? ' Personal edits are frozen during reconciliation.'
                    : ' Local-only personal edits are allowed but will not sync until reconciliation completes.'}
                </p>

                {!reconcilePreview ? (
                  <button
                    type="button"
                    disabled={reconcileLoading || !user}
                    onClick={async () => {
                      if (!user) return;
                      setReconcileLoading(true);
                      setReconcileError(null);
                      setSyncFeedback(null);
                      const preview = await buildReconciliationPreview(user.id);
                      setReconcileLoading(false);
                      if (!preview.ok) {
                        setReconcileError(preview.error);
                        return;
                      }
                      setReconcilePreview(preview);
                      setUseCloudConfirmText('');
                    }}
                    className="flex items-center justify-center gap-2 w-full py-2.5 px-3 bg-primary text-primary-foreground rounded-xl text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-60"
                  >
                    <RefreshCw size={14} className={reconcileLoading ? 'animate-spin' : ''} />
                    {reconcileLoading ? 'Fetching cloud (read-only)…' : 'Reconcile with cloud…'}
                  </button>
                ) : (
                  <div className="space-y-3 p-3 rounded-xl border border-amber-500/25 bg-amber-500/5">
                    <div>
                      <p className="text-xs font-semibold text-foreground">Reconciliation preview</p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        Read-only comparison of this device vs current cloud personal data. Shared
                        IOUs are not part of this decision. Kits saved:{' '}
                        <span className="font-mono">{reconcilePreview.localKitId}</span> (local),{' '}
                        <span className="font-mono">{reconcilePreview.cloudKitId}</span> (cloud).
                        Outbox quarantined: {reconcilePreview.outboxQuarantinedCount}.
                      </p>
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1.5 text-[11px]">
                      {reconcilePreview.tableDiffs
                        .filter(
                          d =>
                            d.localOnlyIds.length ||
                            d.cloudOnlyIds.length ||
                            d.differentIds.length ||
                            d.localCount !== d.cloudCount,
                        )
                        .map(d => (
                          <div
                            key={d.table}
                            className="flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground border-b border-border/40 pb-1"
                          >
                            <span className="font-medium text-foreground w-full">{d.table}</span>
                            <span>local {d.localCount}</span>
                            <span>cloud {d.cloudCount}</span>
                            <span>only-local {d.localOnlyIds.length}</span>
                            <span>only-cloud {d.cloudOnlyIds.length}</span>
                            <span>changed {d.differentIds.length}</span>
                            <span>equal {d.equalCount}</span>
                          </div>
                        ))}
                      {reconcilePreview.tableDiffs.every(
                        d =>
                          !d.localOnlyIds.length &&
                          !d.cloudOnlyIds.length &&
                          !d.differentIds.length,
                      ) && (
                        <p className="text-emerald-700 dark:text-emerald-400">
                          No personal-record differences detected (payload compare excludes
                          updatedAt).
                        </p>
                      )}
                    </div>

                    {reconcilePreview.warnings.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          Account / transaction consistency
                        </p>
                        <ul className="text-[11px] text-muted-foreground space-y-1 max-h-28 overflow-y-auto list-disc pl-4">
                          {reconcilePreview.warnings.slice(0, 12).map((w, i) => (
                            <li key={`${w.accountId}-${w.kind}-${i}`}>{w.detail}</li>
                          ))}
                          {reconcilePreview.warnings.length > 12 && (
                            <li>+{reconcilePreview.warnings.length - 12} more…</li>
                          )}
                        </ul>
                      </div>
                    )}

                    <div className="space-y-2 pt-1">
                      <label className="block text-[11px] text-muted-foreground">
                        Type {USE_CLOUD_CONFIRMATION_PHRASE} to discard this restore and use cloud
                      </label>
                      <input
                        type="text"
                        value={useCloudConfirmText}
                        onChange={e => setUseCloudConfirmText(e.target.value)}
                        placeholder={USE_CLOUD_CONFIRMATION_PHRASE}
                        className="w-full bg-background border border-border/50 rounded-lg px-3 py-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={
                          isApplyingChoiceB ||
                          useCloudConfirmText.trim() !== USE_CLOUD_CONFIRMATION_PHRASE ||
                          !user
                        }
                        onClick={async () => {
                          if (!user || !reconcilePreview) return;
                          const ok = await requestConfirm({
                            title: 'Use cloud and discard this restore?',
                            body:
                              'This replaces personal finance tables on this device with the current cloud snapshot. Cloud is not modified. Recovery and reconciliation kits are kept. Pending settlement outbox stays quarantined.',
                            danger: true,
                          });
                          if (!ok) return;
                          setIsApplyingChoiceB(true);
                          setReconcileError(null);
                          const res = await executeChoiceBUseCloud({
                            userId: user.id,
                            preview: reconcilePreview,
                            confirmationPhrase: useCloudConfirmText,
                          });
                          setIsApplyingChoiceB(false);
                          if (!res.success) {
                            setReconcileError(res.error || 'Choice B failed.');
                            return;
                          }
                          setReconcilePreview(null);
                          setUseCloudConfirmText('');
                          setSyncFeedback({
                            message: `Adopted cloud snapshot (${res.restoredCount ?? 0} rows). Isolation cleared. Review quarantined settlement outbox if any.`,
                            isError: false,
                          });
                        }}
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-3 bg-primary text-primary-foreground rounded-xl text-xs font-medium disabled:opacity-60"
                      >
                        {isApplyingChoiceB ? 'Applying…' : 'Choice B: Use cloud (discard restore)'}
                      </button>

                      <button
                        type="button"
                        disabled
                        title={choiceAUnavailableReason()}
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-3 bg-muted text-muted-foreground rounded-xl text-xs font-medium opacity-60 cursor-not-allowed"
                      >
                        Choice A: Keep this device (disabled)
                      </button>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        {isChoiceAAvailable()
                          ? 'Type KEEP DEVICE after enablement approval to promote this device.'
                          : choiceAUnavailableReason()}
                      </p>

                      <button
                        type="button"
                        disabled={isApplyingChoiceB}
                        onClick={() => {
                          cancelReconciliationPreview();
                          setReconcilePreview(null);
                          setUseCloudConfirmText('');
                          setReconcileError(null);
                        }}
                        className="w-full py-2 text-[11px] text-muted-foreground underline"
                      >
                        Cancel reconciliation (stay isolated)
                      </button>
                    </div>
                  </div>
                )}

                {reconcileError && (
                  <p className="text-[11px] text-destructive leading-relaxed">{reconcileError}</p>
                )}
              </div>
            )}

            {outboxReviewRows.length > 0 && (
              <div className="pt-2 border-t border-border space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  Quarantined settlement outbox ({outboxReviewRows.length})
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  These Shared IOU account intents are held for manual review. Finora will not
                  auto-apply, replay, or delete them. Check cloud settlement status and whether a
                  local balance transaction already exists before acting outside this screen.
                </p>
                <ul className="space-y-2 max-h-56 overflow-y-auto">
                  {outboxReviewRows.map(row => (
                    <li
                      key={row.outbox.id}
                      className="text-[11px] p-2.5 rounded-lg border border-border/50 bg-muted/30 space-y-1"
                    >
                      <p className="font-medium text-foreground font-mono text-[10px]">
                        {row.outbox.id}
                      </p>
                      <p className="text-muted-foreground leading-relaxed">{row.summary}</p>
                      <p className="text-muted-foreground">
                        Account: {row.accountName ?? row.outbox.accountId} · Cloud:{' '}
                        {row.cloudSettlementStatus}
                        {row.sharedIouId ? ` · IOU ${row.sharedIouId}` : ''}
                        {row.existingTxnId ? ` · Txn ${row.existingTxnId}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Emergency: fix cloud duplication */}
            <div className="pt-2">
              <button
                onClick={async () => {
                  const ok = await requestConfirm({
                    title: 'Purge & re-upload cloud data?',
                    body: 'This will DELETE all cloud data for your account and re-upload your current local data as the source of truth.\n\nYour local data is not touched.',
                    danger: true,
                  });
                  if (!ok) return;
                  setIsSyncing(true);
                  setSyncFeedback(null);
                  const res = await purgeAndRepushCloud(user.id);
                  setIsSyncing(false);
                  if (res.success) {
                    setSyncFeedback({ message: 'Cloud cleaned and re-uploaded successfully!', isError: false });
                  } else {
                    setSyncFeedback({ message: res.error || 'Recovery failed.', isError: true });
                  }
                }}
                disabled={isSyncing || cloudSyncIsolated}
                className="flex items-center justify-center gap-2 w-full py-2.5 px-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-60"
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                Fix Cloud Duplicates
              </button>
            </div>

            <div className="pt-2 border-t border-border space-y-2">
              <button
                onClick={async () => { await signOut(); }}
                className="flex items-center gap-2 w-full px-4 py-2.5 bg-muted rounded-xl text-xs font-medium text-foreground active:scale-[0.98] transition-transform"
              >
                <LogOut size={14} className="text-muted-foreground" />
                Sign out
              </button>
              <button
                onClick={async () => {
                  const ok = await requestConfirm({
                    title: 'Delete all cloud data and sign out?',
                    body: 'This will permanently delete all your synced cloud data. Local data on this device remains intact.',
                    danger: true,
                  });
                  if (!ok) return;
                  setIsDeletingAccount(true);
                  const err = await deleteAccountData();
                  setIsDeletingAccount(false);
                  if (err) alert(`Error: ${err}`);
                }}
                disabled={isDeletingAccount}
                className="flex items-center gap-2 w-full px-4 py-2.5 bg-red-500/10 rounded-xl text-xs font-medium text-red-500 active:scale-[0.98] transition-transform disabled:opacity-60"
              >
                <UserX size={14} />
                {isDeletingAccount ? 'Deleting…' : 'Delete cloud backup & sign out'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <p className="text-sm text-muted-foreground mb-4">
              Sign in to back up your data and access it seamlessly from any device or fresh browser.
            </p>
            <button
              onClick={() => navigate('/auth')}
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-accent text-accent-foreground rounded-xl text-sm font-medium active:scale-[0.98] transition-transform"
            >
              <CloudUpload size={18} />
              Back up my data
            </button>
          </div>
        )}
      </section>

      {/* ── Data & Reports ─────────────────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-6">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Data & Reports</h3>
          <p className="text-xs text-muted-foreground mt-1">Export or restore transaction history, accounts and categories.</p>
        </div>
        <div className="p-5 space-y-3">
          {/* Monthly Financial Digest */}
          <button
            onClick={() => setIsDigestModalOpen(true)}
            className="flex items-center justify-between w-full p-3.5 bg-muted/40 hover:bg-muted/70 border border-border rounded-xl text-xs font-medium text-foreground transition-colors"
          >
            <div className="flex items-center gap-3">
              <Sparkles size={20} className="text-amber-500" />
              <div className="text-left">
                <p className="font-medium text-sm text-foreground">Monthly Financial Digest</p>
                <p className="text-[11px] text-muted-foreground">60-second summary of real spending, savings rate, and category shifts</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-foreground text-background rounded-lg text-xs font-semibold">
              View Digest
            </span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center justify-between w-full p-3.5 bg-muted/40 hover:bg-muted/70 border border-border rounded-xl text-xs font-medium text-foreground transition-colors"
          >
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={20} className="text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium text-sm text-foreground">Export CSV or PDF</p>
                <p className="text-[11px] text-muted-foreground">Download spreadsheet or printable financial reports</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold">
              Export
            </span>
          </button>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center justify-between w-full p-3.5 bg-muted/40 hover:bg-muted/70 border border-border rounded-xl text-xs font-medium text-foreground transition-colors"
          >
            <div className="flex items-center gap-3">
              <UploadCloud size={20} className="text-accent" />
              <div className="text-left">
                <p className="font-medium text-sm text-foreground">Import CSV Data</p>
                <p className="text-[11px] text-muted-foreground">Restore transactions, accounts & categories from CSV backup</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-foreground text-background rounded-lg text-xs font-semibold">
              Import
            </span>
          </button>

          {/* Complete JSON Backup */}
          <button
            onClick={async () => {
              await exportFullBackupJSON();
            }}
            className="flex items-center justify-between w-full p-3.5 bg-muted/40 hover:bg-muted/70 border border-border rounded-xl text-xs font-medium text-foreground transition-colors"
          >
            <div className="flex items-center gap-3">
              <FileJson size={20} className="text-emerald-500" />
              <div className="text-left">
                <p className="font-medium text-sm text-foreground">Complete JSON Backup</p>
                <p className="text-[11px] text-muted-foreground">Export all 18 tables: recurring, goals, IOUs, credit float, and accounts</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold">
              Backup
            </span>
          </button>

          {/* Merge restore (upsert, no cloud dirty / no tombstones) */}
          <div className="relative">
            <input
              type="file"
              accept=".json"
              id="json-restore-input"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const ok = await requestConfirm({
                  title: 'Merge backup into local data?',
                  body:
                    'This upserts records from the backup into this device. It does not clear other local rows, does not delete anything in Supabase, and does not mark restored rows for cloud reupload. Export a Complete JSON Backup first if you may need to recover.',
                });
                if (!ok) {
                  e.target.value = '';
                  return;
                }
                setIsRestoringJson(true);
                try {
                  const text = await file.text();
                  const res = await restoreFullBackupJSON(text);
                  if (res.success) {
                    alert(
                      `Merged ${res.restoredCount} items locally.\n\n${res.syncNote || 'Cloud sync was not triggered.'}`,
                    );
                  } else {
                    alert(`Restore failed: ${res.error}`);
                  }
                } catch (err) {
                  alert(`Restore error: ${err instanceof Error ? err.message : 'Unknown'}`);
                } finally {
                  setIsRestoringJson(false);
                  e.target.value = '';
                }
              }}
            />
            <button
              onClick={() => document.getElementById('json-restore-input')?.click()}
              disabled={isRestoringJson}
              className="flex items-center justify-between w-full p-3.5 bg-muted/40 hover:bg-muted/70 border border-border rounded-xl text-xs font-medium text-foreground transition-colors disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <UploadCloud size={20} className="text-emerald-500" />
                <div className="text-left">
                  <p className="font-medium text-sm text-foreground">Merge JSON Backup (local)</p>
                  <p className="text-[11px] text-muted-foreground">
                    Upsert backup rows into this device only — no cloud deletes or mass reupload
                  </p>
                </div>
              </div>
              <span className="px-3 py-1.5 bg-muted border border-border rounded-lg text-xs font-semibold text-foreground">
                {isRestoringJson ? 'Restoring…' : 'Merge'}
              </span>
            </button>
          </div>

          {/* Replace-all: Option 1 local-only offline snapshot */}
          <div className="relative">
            <input
              type="file"
              accept=".json"
              id="json-replace-all-input"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  setReplaceConfirmText('');
                  setRecoveryKitSaved(false);
                  setReplaceBackupJson(text);
                  setReplaceAllPlan(planReplaceAllRestore(text));
                } catch (err) {
                  alert(`Could not read backup: ${err instanceof Error ? err.message : 'Unknown'}`);
                } finally {
                  e.target.value = '';
                }
              }}
            />
            <button
              onClick={() => document.getElementById('json-replace-all-input')?.click()}
              disabled={cloudSyncIsolated}
              className="flex items-center justify-between w-full p-3.5 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-xl text-xs font-medium text-foreground transition-colors disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <UploadCloud size={20} className="text-red-500" />
                <div className="text-left">
                  <p className="font-medium text-sm text-foreground">Replace existing local data</p>
                  <p className="text-[11px] text-muted-foreground">
                    Local-only offline snapshot — requires recovery kit + REPLACE confirmation; sync stays isolated
                  </p>
                </div>
              </div>
              <span className="px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg text-xs font-semibold">
                Replace
              </span>
            </button>
          </div>

          {replaceAllPlan && replaceBackupJson && (
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
              <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-red-500">
                      Replace existing local data
                    </p>
                    <h3 className="text-lg font-medium text-foreground mt-1">Local-only restore plan</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setReplaceAllPlan(null);
                      setReplaceBackupJson(null);
                      setReplaceConfirmText('');
                      setRecoveryKitSaved(false);
                    }}
                    className="p-2 bg-muted rounded-full text-muted-foreground"
                  >
                    <X size={16} />
                  </button>
                </div>

                <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
                  {replaceAllPlan.warnings.map(w => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>

                {replaceAllPlan.totalItems > 0 && (
                  <div className="text-xs bg-muted/50 border border-border rounded-xl p-3 space-y-1">
                    <p className="font-medium text-foreground">
                      Backup items: {replaceAllPlan.totalItems}
                      {replaceAllPlan.version != null ? ` · v${replaceAllPlan.version}` : ''}
                    </p>
                    <p className="text-muted-foreground">
                      Accounts: {replaceAllPlan.tableCounts.accounts ?? 0} · Transactions:{' '}
                      {replaceAllPlan.tableCounts.transactions ?? 0} · Categories:{' '}
                      {replaceAllPlan.tableCounts.categories ?? 0}
                    </p>
                    <p className="text-muted-foreground pt-1">
                      Preserved (not replaced): Shared IOUs, connections, notifications, profiles,
                      statement reader, settlement outbox.
                    </p>
                  </div>
                )}

                {replaceAllPlan.blocked ? (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-muted-foreground">
                    {replaceAllPlan.blockerReason}
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={isPreparingRecovery}
                      onClick={async () => {
                        setIsPreparingRecovery(true);
                        try {
                          const { kit, verified } = await buildRecoveryKit();
                          if (!verified) {
                            alert('Recovery kit verification failed. Nothing was changed.');
                            return;
                          }
                          downloadRecoveryKit(kit);
                          setRecoveryKitSaved(false);
                          alert(
                            'Recovery kit downloaded. It includes your current personal data plus dirty/deleted sync metadata. Store it safely, then check the acknowledgment box.',
                          );
                        } catch (err) {
                          alert(err instanceof Error ? err.message : 'Could not build recovery kit.');
                        } finally {
                          setIsPreparingRecovery(false);
                        }
                      }}
                      className="w-full py-2.5 bg-muted border border-border rounded-xl text-xs font-semibold text-foreground disabled:opacity-60"
                    >
                      {isPreparingRecovery ? 'Preparing recovery kit…' : '1. Download recovery kit (required)'}
                    </button>

                    <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={recoveryKitSaved}
                        onChange={e => setRecoveryKitSaved(e.target.checked)}
                        className="mt-0.5 rounded border-border"
                      />
                      <span className="text-muted-foreground">
                        I saved the recovery kit file (includes sync dirty/deleted metadata) and can
                        use it if this restore fails.
                      </span>
                    </label>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                        Type {REPLACE_CONFIRMATION_PHRASE} to confirm
                      </label>
                      <input
                        type="text"
                        value={replaceConfirmText}
                        onChange={e => setReplaceConfirmText(e.target.value)}
                        className="w-full p-3 bg-background border border-border rounded-xl text-sm text-foreground"
                        placeholder={REPLACE_CONFIRMATION_PHRASE}
                        autoComplete="off"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={
                        isExecutingReplace ||
                        !recoveryKitSaved ||
                        replaceConfirmText.trim() !== REPLACE_CONFIRMATION_PHRASE
                      }
                      onClick={async () => {
                        if (!replaceBackupJson) return;
                        setIsExecutingReplace(true);
                        try {
                          const res = await executeReplaceAllLocalOnly(replaceBackupJson, {
                            confirmationPhrase: replaceConfirmText,
                            recoveryKitSavedAcknowledged: recoveryKitSaved,
                          });
                          if (res.success) {
                            alert(
                              `Local replace-all complete (${res.restoredCount} items). Cloud sync is now isolated on this device. Keep your recovery kit.`,
                            );
                            setReplaceAllPlan(null);
                            setReplaceBackupJson(null);
                            window.location.reload();
                          } else {
                            alert(res.error || 'Replace failed.');
                          }
                        } finally {
                          setIsExecutingReplace(false);
                        }
                      }}
                      className="w-full py-3 bg-red-500 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                      {isExecutingReplace
                        ? 'Replacing local data…'
                        : '2. Replace local personal data (enter isolation)'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <button
            onClick={async () => {
              const ok = await requestConfirm({
                title: 'Wipe ALL local data?',
                body: 'This will completely wipe local database storage on this device for all accounts, transactions, and categories.',
                danger: true,
              });
              if (!ok) return;
              await Promise.all([
                db.accounts.clear(),
                db.transactions.clear(),
                db.categories.clear(),
                db.tags.clear(),
                db.budgets.clear(),
                db.recurringTransactions.clear(),
                db.savingsGoals.clear(),
                db.creditCards.clear(),
                db.cashOffsetSources.clear(),
                db.fixedDeposits.clear(),
                db.moneyMarketAccounts.clear(),
                db.installmentPlans.clear(),
                db.cardPromos.clear(),
                db.floatGapHistory.clear(),
                db.reimbursementLedgers.clear(),
                db.reimbursementEntries.clear(),
                db.people.clear(),
                db.debts.clear(),
              ]);
              localStorage.removeItem('finora-dirty');
              alert('All local data has been cleared.');
            }}
            className="flex items-center justify-between w-full p-3.5 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-xl text-xs font-medium text-red-500 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Trash2 size={20} className="text-red-500" />
              <div className="text-left">
                <p className="font-medium text-sm text-red-500">Clear All Local Data</p>
                <p className="text-[11px] text-muted-foreground">Wipe all accounts, tags, categories, transactions and reset storage</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold">
              Wipe
            </span>
          </button>
        </div>
      </section>

      {/* ── Advanced Tools (Power Users) ────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-6">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Advanced Tools</h3>
          <p className="text-xs text-muted-foreground mt-1">Specialized power-user tools for credit float management and ledgers.</p>
        </div>
        <div className="p-5 space-y-3">
          <button
            onClick={() => navigate('/float-tools')}
            className="flex items-center justify-between w-full p-3.5 bg-muted/40 hover:bg-muted/70 border border-border rounded-xl text-xs font-medium text-foreground transition-colors"
          >
            <div className="flex items-center gap-3">
              <CreditCard size={20} className="text-accent" />
              <div className="text-left">
                <p className="font-medium text-sm text-foreground">Credit &amp; Float Tools</p>
                <p className="text-[11px] text-muted-foreground">Multi-card float tracking, exposure stress-tests, installments &amp; ledgers</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-foreground text-background rounded-lg text-xs font-semibold">
              Open
            </span>
          </button>

          <button
            onClick={() => navigate('/statements')}
            className="flex items-center justify-between w-full p-3.5 bg-muted/40 hover:bg-muted/70 border border-border rounded-xl text-xs font-medium text-foreground transition-colors"
          >
            <div className="flex items-center gap-3">
              <FileText size={20} className="text-accent" />
              <div className="text-left">
                <p className="font-medium text-sm text-foreground">Statement Reader</p>
                <p className="text-[11px] text-muted-foreground">Client-side PDF credit card statement interpreter, installment tracking &amp; breakdown</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-foreground text-background rounded-lg text-xs font-semibold">
              Open
            </span>
          </button>
        </div>
      </section>

      {/* ── Appearance ──────────────────────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-8">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Appearance</h3>
          <p className="text-xs text-muted-foreground mt-1">Customize the look and feel of the app.</p>
        </div>
        <div className="p-5">
          <div className="flex bg-muted p-1 rounded-xl">
            {(['light', 'dark', 'system'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg capitalize transition-colors ${
                  theme === t ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'light' ? <Sun size={14} /> : t === 'dark' ? <Moon size={14} /> : <Monitor size={14} />}
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Glance Colors ──────────────────────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-8">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Glance Colors</h3>
          <p className="text-xs text-muted-foreground mt-1">Use color to highlight financial importance.</p>
        </div>
        <div className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Budget progress</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={glanceBudget}
                onChange={(e) => setGlanceBudget(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-foreground"></div>
            </label>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Transaction amounts</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={glanceTransactions}
                onChange={(e) => setGlanceTransactions(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-foreground"></div>
            </label>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Upcoming payments</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={glanceUpcoming}
                onChange={(e) => setGlanceUpcoming(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-foreground"></div>
            </label>
          </div>
        </div>
      </section>

      {/* ── Navigation Preferences ─────────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-8">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Bottom Navigation Bar</h3>
          <p className="text-xs text-muted-foreground mt-1">Customize which destinations appear on your mobile bottom bar.</p>
        </div>
        <div className="p-5">
          <button
            onClick={() => setCustomizeModalOpen(true)}
            className="flex items-center justify-between w-full p-3.5 bg-muted/40 hover:bg-muted/70 border border-border rounded-xl text-xs font-medium text-foreground transition-colors"
          >
            <div className="flex items-center gap-3">
              <SlidersHorizontal size={20} className="text-accent" />
              <div className="text-left">
                <p className="font-medium text-sm text-foreground">Customize Bottom Bar</p>
                <p className="text-[11px] text-muted-foreground">Toggle front vs hidden items (4 to 6 options)</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold">
              Customize
            </span>
          </button>
        </div>
      </section>

      {/* ── Home & Privacy Preferences ──────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-8">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Home &amp; Privacy Preferences</h3>
          <p className="text-xs text-muted-foreground mt-1">Configure cashflow forecasting and privacy masking preferences.</p>
        </div>
        <div className="p-5 space-y-5">
          {/* Safe-to-Spend Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Safe-to-Spend Forecast</p>
              <p className="text-xs text-muted-foreground">Show forward-looking cashflow liquidity card on Home Overview</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={showSafeToSpendHome}
                onChange={(e) => setShowSafeToSpendHome(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-foreground"></div>
            </label>
          </div>

          {/* Forecast Days Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-border">
            <div>
              <p className="text-xs font-medium text-foreground">Forecast Horizon</p>
              <p className="text-[11px] text-muted-foreground">Days ahead to calculate upcoming recurring expenses</p>
            </div>
            <div className="flex items-center gap-1 bg-muted p-1 rounded-xl">
              {[7, 14, 30].map(days => (
                <button
                  key={days}
                  onClick={() => setSafeToSpendForecastDays(days)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    safeToSpendForecastDays === days
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>
          </div>

          {/* Privacy Incognito Mode */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <div className="flex items-center gap-2.5">
              {isMasked ? <EyeOff size={18} className="text-amber-500" /> : <Eye size={18} className="text-muted-foreground" />}
              <div>
                <p className="text-sm font-medium text-foreground">Privacy Masking</p>
                <p className="text-xs text-muted-foreground">Mask all monetary figures across the app with •••••</p>
              </div>
            </div>
            <button
              onClick={toggleMask}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                isMasked
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              {isMasked ? 'Masked (Active)' : 'Unmasked'}
            </button>
          </div>

          {/* 1-Tap Instant Logging Toggle */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <div>
              <p className="text-sm font-medium text-foreground">1-Tap Instant Logging</p>
              <p className="text-xs text-muted-foreground">Tapping a chip logs it instantly with an Undo toast instead of opening the form</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={oneTapLogMode}
                onChange={(e) => setOneTapLogMode(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-foreground"></div>
            </label>
          </div>
        </div>
      </section>

      {/* ── Manage Tags ─────────────────────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Manage Tags</h3>
          <p className="text-xs text-muted-foreground mt-1">Rename, merge, or delete tags created during transactions.</p>
        </div>
        
        <div className="divide-y divide-border">
          {tags.map(tag => (
            <div key={tag.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {editingId === tag.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input 
                    type="text" 
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="flex-1 p-2 bg-background border border-border rounded-lg text-sm text-foreground outline-none focus:border-foreground"
                    autoFocus
                  />
                  <button onClick={() => saveEdit(tag.id)} className="p-2 bg-accent text-accent-foreground rounded-lg"><Check size={16}/></button>
                  <button onClick={() => setEditingId(null)} className="p-2 bg-muted text-muted-foreground rounded-lg"><X size={16}/></button>
                </div>
              ) : mergingId === tag.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">Merge into:</span>
                  <select 
                    value={targetMergeId}
                    onChange={e => setTargetMergeId(e.target.value)}
                    className="flex-1 p-2 bg-background border border-border rounded-lg text-sm text-foreground outline-none focus:border-foreground"
                  >
                    <option value="">Select target tag...</option>
                    {tags.filter(t => t.id !== tag.id).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button onClick={() => handleMerge(tag.id)} disabled={!targetMergeId} className="p-2 bg-accent text-accent-foreground rounded-lg disabled:opacity-50"><Check size={16}/></button>
                  <button onClick={() => setMergingId(null)} className="p-2 bg-muted text-muted-foreground rounded-lg"><X size={16}/></button>
                </div>
              ) : (
                <>
                  <div className="flex items-center">
                    <span className="inline-block px-3 py-1 bg-muted text-foreground rounded-full text-sm font-medium">
                      #{tag.name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button onClick={() => handleEdit(tag.id, tag.name)} className="p-2 text-muted-foreground hover:text-foreground transition-colors">
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => { setMergingId(tag.id); setTargetMergeId(''); setEditingId(null); }} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="Merge">
                      <Merge size={16} />
                    </button>
                    <button onClick={() => handleDelete(tag.id)} className="p-2 text-red-500 hover:text-red-600 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {tags.length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No tags created yet. Create them on the fly when adding transactions.
            </div>
          )}
        </div>
      </section>

      {/* ── Manage Categories ────────────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mt-6">
        <div className="p-5 border-b border-border bg-muted/50 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-foreground">Manage Categories</h3>
            <p className="text-xs text-muted-foreground mt-1">Add, rename, or delete your spending categories.</p>
          </div>
          <button
            onClick={() => { setShowAddCat(v => !v); setNewCatName(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-medium active:scale-95 transition-transform"
          >
            <Plus size={14} />
            New
          </button>
        </div>

        {/* Add form */}
        {showAddCat && (
          <div className="p-4 border-b border-border bg-muted/30 space-y-3 animate-in slide-in-from-top-2 fade-in duration-200">
            <input
              type="text"
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddCategory(); }}
              autoFocus
              placeholder="Category name…"
              className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
            />
            {/* Type toggle */}
            <div className="flex bg-muted p-1 rounded-xl">
              {(['expense', 'income'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewCatType(t)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                    newCatType === t ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {/* Color swatches */}
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setNewCatColor(c); setCatError(''); }}
                  className={`w-7 h-7 rounded-full transition-transform active:scale-90 ${newCatColor === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            {catError && <p className="text-xs text-red-500 font-medium">{catError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAddCategory}
                disabled={!newCatName.trim()}
                className="flex-1 py-2.5 bg-accent text-accent-foreground rounded-xl text-sm font-medium active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => { setShowAddCat(false); setCatError(''); }}
                className="px-4 py-2.5 bg-muted text-muted-foreground rounded-xl text-sm font-medium active:scale-[0.98] transition-transform"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Category list */}
        <div className="divide-y divide-border">
          {(['expense', 'income'] as const).map(type => {
            const group = categories.filter(c => c.type === type);
            if (group.length === 0) return null;
            return (
              <div key={type}>
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {type}
                </p>
                {group.map(cat => (
                  <div key={cat.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    {editingCatId === cat.id ? (
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          <input
                            type="text"
                            value={editCatName}
                            onChange={e => { setEditCatName(e.target.value); setEditCatError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(cat.id); }}
                            autoFocus
                            className="flex-1 p-2 bg-background border border-border rounded-lg text-sm text-foreground outline-none focus:border-foreground"
                          />
                          <button onClick={() => handleRenameCategory(cat.id)} className="p-2 bg-accent text-accent-foreground rounded-lg"><Check size={15} /></button>
                          <button onClick={() => { setEditingCatId(null); setEditCatError(''); }} className="p-2 bg-muted text-muted-foreground rounded-lg"><X size={15} /></button>
                        </div>
                        {editCatError && <p className="text-xs text-red-500 font-medium pl-5">{editCatError}</p>}
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2.5">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          <span className="text-sm font-medium text-foreground">{cat.name}</span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.name); }}
                            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteCategory(cat.id, cat.name)}
                            className="p-2 text-red-500 hover:text-red-600 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {categories.length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No categories yet. Tap "New" to create one.
            </div>
          )}
        </div>
      </section>

      {/* App Branding & Version */}
      <div className="flex flex-col items-center justify-center pt-8 pb-4 text-center opacity-75">
        <Logo size={32} className="mb-2.5" />
        <p className="text-xs font-semibold text-foreground">Finora</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Minimal Budget & Expense Tracker</p>
      </div>

      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />

      <ImportDataModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />

      <MonthlyDigestModal
        isOpen={isDigestModalOpen}
        onClose={() => setIsDigestModalOpen(false)}
      />
    </div>
  );
}



