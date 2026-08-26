import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Trash2, Edit2, Check, X, Merge } from 'lucide-react';

export default function Settings() {
  const tags = useLiveQuery(() => db.tags.toArray()) || [];
  
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
    await db.tags.update(id, { name: editName.trim() });
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this tag? It will be removed from all transactions.')) {
      await db.transaction('rw', db.tags, db.transactions, async () => {
        // Remove tag from transactions
        const txns = await db.transactions.filter(t => !!t.tagIds && t.tagIds.includes(id)).toArray();
        for (const txn of txns) {
          if (txn.tagIds) {
            await db.transactions.update(txn.id, {
              tagIds: txn.tagIds.filter(tid => tid !== id)
            });
          }
        }
        // Delete tag
        await db.tags.delete(id);
      });
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
            await db.transactions.update(txn.id, { tagIds: Array.from(newTags) });
          }
        }
        await db.tags.delete(sourceId);
      });
      setMergingId(null);
      setTargetMergeId('');
    }
  };

  return (
    <div className="p-6 pb-24">
      <h2 className="text-2xl font-medium text-gray-900 mb-6">Settings</h2>
      
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 bg-gray-50">
          <h3 className="font-medium text-gray-900">Manage Tags</h3>
          <p className="text-xs text-gray-500 mt-1">Rename, merge, or delete tags created during transactions.</p>
        </div>
        
        <div className="divide-y divide-gray-100">
          {tags.map(tag => (
            <div key={tag.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {editingId === tag.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input 
                    type="text" 
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="flex-1 p-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-gray-900"
                    autoFocus
                  />
                  <button onClick={() => saveEdit(tag.id)} className="p-2 bg-gray-900 text-white rounded-lg"><Check size={16}/></button>
                  <button onClick={() => setEditingId(null)} className="p-2 bg-gray-100 text-gray-600 rounded-lg"><X size={16}/></button>
                </div>
              ) : mergingId === tag.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-sm font-medium">Merge into:</span>
                  <select 
                    value={targetMergeId}
                    onChange={e => setTargetMergeId(e.target.value)}
                    className="flex-1 p-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-gray-900"
                  >
                    <option value="">Select target tag...</option>
                    {tags.filter(t => t.id !== tag.id).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button onClick={() => handleMerge(tag.id)} disabled={!targetMergeId} className="p-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"><Check size={16}/></button>
                  <button onClick={() => setMergingId(null)} className="p-2 bg-gray-100 text-gray-600 rounded-lg"><X size={16}/></button>
                </div>
              ) : (
                <>
                  <div className="flex items-center">
                    <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                      #{tag.name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button onClick={() => handleEdit(tag.id, tag.name)} className="p-2 text-gray-400 hover:text-gray-900 transition-colors">
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => { setMergingId(tag.id); setTargetMergeId(''); setEditingId(null); }} className="p-2 text-gray-400 hover:text-gray-900 transition-colors" title="Merge">
                      <Merge size={16} />
                    </button>
                    <button onClick={() => handleDelete(tag.id)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {tags.length === 0 && (
            <div className="p-6 text-center text-gray-500 text-sm">
              No tags created yet. Create them on the fly when adding transactions.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
