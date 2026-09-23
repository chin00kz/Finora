import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import type { CacheProfile } from '../db/db';

export default function FinoraProfileWidget() {
  const { user } = useAuthStore();
  const [profile, setProfile] = useState<CacheProfile | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [setupError, setSetupError] = useState('');
  
  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error) {
        if (error.code === 'PGRST116') {
          console.log('No profile exists yet.');
        } else {
          console.error('Error loading profile:', error);
        }
      } else if (data) {
        setProfile(data);
        await db.cacheProfiles.put(data);
      }
    } catch (e) {
      console.error('Exception in loadProfile:', e);
    }
    setLoading(false);
  };

  const handleCreateProfile = async () => {
    if (!user) return;
    setSetupError('');
    if (username.length < 3 || username.length > 24 || !/^[a-z0-9_]+$/.test(username)) {
      setSetupError('Username must be 3-24 characters, lowercase letters, numbers, and underscores only.');
      return;
    }
    if (!displayName.trim()) {
      setSetupError('Display name is required.');
      return;
    }
    
    try {
      const { error } = await supabase.rpc('create_profile', {
        p_username: username,
        p_display_name: displayName
      });
      /*
        id: user.id,
        username,
        display_name: displayName,
        created_at: Date.now()
      });*/
      if (error) throw error;
      await loadProfile();
    } catch (e: any) {
      let msg = 'Failed to create profile.';
      if (e.message?.includes('username_taken')) msg = 'Username is already taken.';
      else if (e.message?.includes('profile_exists')) msg = 'Your Finora profile already exists.';
      else if (e.message?.includes('display_name_invalid')) msg = 'Display name cannot be empty or exceed 50 characters.';
      else if (e.message?.includes('username_reserved')) msg = 'This username is reserved and cannot be used.';
      else if (e.message?.includes('username_invalid_format')) msg = 'Username contains invalid characters.';
      else if (e.message?.includes('username_invalid_length')) msg = 'Username must be 3-24 characters long.';
      setSetupError(msg);
    }
  };

  if (!user || loading) return null;

  return (
    <div className="p-5 border-b border-border space-y-3">
      <p className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Finora Profile</p>
      
      {!profile ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">Create a profile to connect with friends.</p>
          <div className="space-y-2">
            <input type="text" placeholder="username (e.g. alex_123)" className="w-full bg-background border border-border/50 rounded-xl px-4 py-2 text-sm" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} />
            <input type="text" placeholder="Display Name" className="w-full bg-background border border-border/50 rounded-xl px-4 py-2 text-sm" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          {setupError && <p className="text-sm text-red-500">{setupError}</p>}
          <button onClick={handleCreateProfile} className="w-full py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium">Create Profile</button>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium text-foreground mt-0.5">{profile.display_name}</p>
          <p className="text-xs text-muted-foreground mt-1">@{profile.username}</p>
        </div>
      )}
    </div>
  );
}




