import { useState, useMemo } from 'react';
import { X, Search, Users, Clock, Check, User } from 'lucide-react';
import { UnifiedIdentity } from '../hooks/useParticipantIdentities';

interface Group {
  id: string;
  name: string;
  participantIds: string[];
}

interface RecentCombo {
  keys: string[];
  names: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  identities: UnifiedIdentity[];
  groups: Group[];
  recentCombinations: RecentCombo[];
  selectedKeys: string[];
  onToggleSelection: (key: string) => void;
  onSelectMultiple: (keys: string[]) => void;
}

export default function ParticipantPickerSheet({
  isOpen,
  onClose,
  identities,
  groups,
  recentCombinations,
  selectedKeys,
  onToggleSelection,
  onSelectMultiple
}: Props) {
  const [search, setSearch] = useState('');

  const filteredIdentities = useMemo(() => {
    if (!search.trim()) return identities;
    const lower = search.toLowerCase();
    return identities.filter(i => i.name.toLowerCase().includes(lower));
  }, [identities, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in slide-in-from-bottom-full duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-semibold">Select People</h2>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-muted text-muted-foreground">
          <X size={20} />
        </button>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search friends or local people..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-muted text-foreground outline-none rounded-xl pl-10 pr-4 py-3"
            autoFocus
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-8 pb-24">
        
        {/* Recents & Groups (Only show if not searching) */}
        {!search.trim() && (
          <>
            {recentCombinations.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Clock size={14} /> Recent Combinations
                </h3>
                <div className="flex flex-wrap gap-2">
                  {recentCombinations.map((combo, i) => (
                    <button
                      key={i}
                      onClick={() => onSelectMultiple(combo.keys)}
                      className="px-3 py-1.5 bg-muted hover:bg-muted/80 border border-border rounded-full text-sm font-medium transition-colors text-left"
                    >
                      {combo.names.join(', ')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {groups.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Users size={14} /> Groups
                </h3>
                <div className="flex flex-wrap gap-2">
                  {groups.map(group => (
                    <button
                      key={group.id}
                      onClick={() => onSelectMultiple(group.participantIds)}
                      className="px-3 py-1.5 bg-muted hover:bg-muted/80 border border-border rounded-full text-sm font-medium transition-colors"
                    >
                      {group.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* All People */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <User size={14} /> {search.trim() ? 'Results' : 'All People'}
          </h3>
          <div className="space-y-1">
            {filteredIdentities.map(person => {
              const isSelected = selectedKeys.includes(person.identityKey);
              return (
                <button
                  key={person.identityKey}
                  onClick={() => onToggleSelection(person.identityKey)}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted rounded-xl transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
                      {person.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{person.name}</p>
                      {person.isConnected && (
                        <p className="text-[11px] text-green-500 font-medium">Connected Friend</p>
                      )}
                    </div>
                  </div>
                  <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'border-muted-foreground/30'}`}>
                    {isSelected && <Check size={14} />}
                  </div>
                </button>
              );
            })}
            
            {filteredIdentities.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No people found.</p>
            )}
          </div>
        </div>
      </div>

      {/* Footer / Done Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-md border-t border-border">
        <button
          onClick={onClose}
          className="w-full py-3.5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-500/20"
        >
          Done ({selectedKeys.length})
        </button>
      </div>
    </div>
  );
}
