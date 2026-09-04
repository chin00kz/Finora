import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Trash2, Edit2, Check, X, Merge, Moon, Sun, Monitor, LogOut, UserX, CloudUpload, RefreshCw, Download, CheckCircle, Plus } from 'lucide-react';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { syncAll, hydrateFromCloud, triggerSync, deleteFromCloud } from '../sync/syncEngine';
import { useNavigate } from 'react-router-dom';

export default function Settings() {
  const navigate = useNavigate();
  const tags = useLiveQuery(() => db.tags.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const { theme, setTheme } = useThemeStore();
  const { user, lastSyncedAt, signOut, deleteAccountData } = useAuthStore();

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

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
    await db.tags.update(id, { name: editName.trim(), updatedAt: Date.now() });
    setEditingId(null);
    triggerSync();
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this tag? It will be removed from all transactions.')) {
      await db.transaction('rw', db.tags, db.transactions, async () => {
        const txns = await db.transactions.filter(t => !!t.tagIds && t.tagIds.includes(id)).toArray();
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
      triggerSync();
    }
  };

  const handleMerge = async (sourceId: string) => {
    if (!targetMergeId || targetMergeId === sourceId) return;
    
    if (confirm('Are you sure you want to merge these tags? This cannot be undone.')) {
      await db.transaction('rw', db.tags, db.transactions, async () => {
        const txns = await db.transactions.filter(t => !!t.tagIds && t.tagIds.includes(sourceId)).toArray();
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
      triggerSync();
      setMergingId(null);
      setTargetMergeId('');
    }
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
    const id = `cat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await db.categories.add({ id, name, type: newCatType, icon: 'tag', color: newCatColor, updatedAt: Date.now() });
    triggerSync();
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
    triggerSync();
    setEditingCatId(null);
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!confirm(`Delete the "${name}" category? Transactions using it will have no category.`)) return;
    await db.transaction('rw', db.categories, db.transactions, async () => {
      await db.transactions.filter(t => t.categoryId === id).modify({ categoryId: undefined });
      await db.categories.delete(id);
    });
    await deleteFromCloud('categories', id);
    triggerSync();
  };

  return (
    <div className="p-6 pb-24">
      <h2 className="text-2xl font-medium text-foreground mb-6">Settings</h2>

      {/* ── Account ─────────────────────────────────────────────────────────── */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-6">
        <div className="p-5 border-b border-border bg-muted/50">
          <h3 className="font-medium text-foreground">Account & Cloud Sync</h3>
          <p className="text-xs text-muted-foreground mt-1">Automatic two-way cloud backup across devices.</p>
        </div>
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
                disabled={isSyncing}
                className="flex items-center justify-center gap-2 py-2.5 px-3 bg-accent text-accent-foreground rounded-xl text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-60"
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing…' : 'Sync Now'}
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
                disabled={isSyncing}
                className="flex items-center justify-center gap-2 py-2.5 px-3 bg-muted text-foreground rounded-xl text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-60"
              >
                <Download size={14} />
                Pull Cloud Data
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
                  if (!confirm('This will permanently delete all your synced cloud data. Local data on this device remains intact. Continue?')) return;
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
    </div>
  );
}
