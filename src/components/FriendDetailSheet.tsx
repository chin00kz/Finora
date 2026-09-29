import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CacheConnection, type CacheProfile } from '../db/db';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { syncConnections } from '../sync/connectionSync';
import { triggerSync } from '../sync/syncEngine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  connection: CacheConnection | null;
  profile: CacheProfile | null;
  currentUserId: string | undefined;
}

export default function FriendDetailSheet({ isOpen, onClose, connection, profile, currentUserId }: Props) {
  const [selectedPersonId, setSelectedPersonId] = useState<string | undefined>(undefined);
  const [isLinking, setIsLinking] = useState(false);
  const [isSettingAutoAccept, setIsSettingAutoAccept] = useState(false);

  const people = useLiveQuery(() => db.people.toArray()) || [];

  useEffect(() => {
    if (isOpen && connection) {
      setSelectedPersonId(undefined);
    }
  }, [isOpen, connection]);

  if (!isOpen || !connection || !profile || !currentUserId) return null;

  const linkedPerson = people.find(p => p.connection_id === connection.id);
  const isUserA = currentUserId === connection.user_a;

  // My auto-accept preference: did *I* (the current user) enable auto-accepting IOUs from this friend?
  // user_a_auto_accepts_ious = user_a said "auto-accept requests coming from user_b"
  // user_b_auto_accepts_ious = user_b said "auto-accept requests coming from user_a"
  const myAutoAccept = isUserA
    ? (connection.user_a_auto_accepts_ious ?? false)
    : (connection.user_b_auto_accepts_ious ?? false);

  const handleToggleAutoAccept = async (checked: boolean) => {
    setIsSettingAutoAccept(true);
    try {
      await supabase.rpc('set_connection_auto_accept', {
        p_connection_id: connection.id,
        p_auto_accept: checked,
      });
      await syncConnections(currentUserId);
    } catch (e: any) {
      console.error('Failed to set auto-accept:', e);
      alert(e.message || 'Failed to update setting. Please try again.');
    } finally {
      setIsSettingAutoAccept(false);
    }
  };

  const handleSaveLink = async () => {
    if (selectedPersonId === undefined) return;
    setIsLinking(true);
    try {
      const now = Date.now();
      if (!selectedPersonId) {
        // Unlinking
        if (linkedPerson) {
          await db.people.update(linkedPerson.id, { connection_id: null as any, updatedAt: now });
          triggerSync('people', linkedPerson.id);
        }
      } else {
        // Unlink previous if different
        if (linkedPerson && linkedPerson.id !== selectedPersonId) {
          await db.people.update(linkedPerson.id, { connection_id: null as any, updatedAt: now });
          triggerSync('people', linkedPerson.id);
        }
        await db.people.update(selectedPersonId, { connection_id: connection.id, updatedAt: now });
        triggerSync('people', selectedPersonId);
      }
      setSelectedPersonId(undefined);
    } catch (e) {
      console.error(e);
      alert('Failed to link person');
    } finally {
      setIsLinking(false);
    }
  };

  const currentValue = selectedPersonId !== undefined ? selectedPersonId : (linkedPerson?.id || '');

  return (
    <>
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100]"
        onClick={onClose}
      />

      <div className="fixed inset-x-0 bottom-0 z-[101] bg-card border-t border-border rounded-t-3xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex-none p-4 pb-2 text-center relative border-b border-border/50">
          <div className="w-12 h-1.5 bg-border rounded-full mx-auto mb-4" />
          <h2 className="text-xl font-medium tracking-tight text-foreground">Friend Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 p-2 text-muted-foreground hover:bg-muted rounded-full transition-colors"
            aria-label="Close friend details"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* Profile */}
          <div className="text-center">
            <div className="w-16 h-16 bg-accent/10 text-accent rounded-full flex items-center justify-center text-2xl font-medium mx-auto mb-3">
              {profile.display_name.charAt(0).toUpperCase()}
            </div>
            <h3 className="text-lg font-medium text-foreground">{profile.display_name}</h3>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
          </div>

          {/* Trust Settings */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-foreground/80 uppercase tracking-wider">Trust Settings</h4>

            <div className="bg-background border border-border/50 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-foreground">
                  Auto-accept IOU requests from {profile.display_name}
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={myAutoAccept}
                  aria-label={`Auto-accept IOU requests from ${profile.display_name}`}
                  disabled={isSettingAutoAccept}
                  onClick={() => handleToggleAutoAccept(!myAutoAccept)}
                  className={`w-11 h-6 rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    myAutoAccept ? 'bg-accent' : 'bg-border'
                  } ${isSettingAutoAccept ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${myAutoAccept ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                IOUs created by this person where you owe them will be accepted automatically. You can still reject them afterward.
              </p>
            </div>
          </div>

          {/* Local Person Link */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-foreground/80 uppercase tracking-wider">Local Link</h4>
            <div className="bg-background border border-border/50 rounded-2xl p-4">
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Link local Person record (optional)
              </label>
              <div className="flex gap-2">
                <select
                  className="flex-1 bg-card text-sm text-foreground border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                  value={currentValue}
                  onChange={(e) => setSelectedPersonId(e.target.value)}
                >
                  <option value="">No person linked...</option>
                  {people.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {selectedPersonId !== undefined && selectedPersonId !== (linkedPerson?.id || '') && (
                  <button
                    type="button"
                    onClick={handleSaveLink}
                    disabled={isLinking}
                    className="px-4 py-2 bg-foreground text-background text-sm font-medium rounded-xl hover:opacity-90 disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
