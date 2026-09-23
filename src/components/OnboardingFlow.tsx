import { useState } from 'react';
import { supabase } from '../lib/supabase';
import Logo from './Logo';

export default function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (username.length < 3 || username.length > 24 || !/^[a-z0-9_]+$/.test(username)) {
      setError('Username must be 3-24 characters, lowercase letters, numbers, and underscores only.');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }

    setLoading(true);
    try {
      const { error: rpcError } = await supabase.rpc('create_profile', {
        p_username: username,
        p_display_name: displayName
      });
      if (rpcError) throw rpcError;
      onComplete();
    } catch (e: any) {
      let msg = 'Failed to create profile.';
      if (e.message?.includes('username_taken')) msg = 'Username is already taken.';
      else if (e.message?.includes('profile_exists')) msg = 'Your Finora profile already exists.';
      else if (e.message?.includes('display_name_invalid')) msg = 'Display name cannot be empty or exceed 50 characters.';
      else if (e.message?.includes('username_reserved')) msg = 'This username is reserved and cannot be used.';
      else if (e.message?.includes('username_invalid_format')) msg = 'Username contains invalid characters.';
      else if (e.message?.includes('username_invalid_length')) msg = 'Username must be 3-24 characters long.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full space-y-8 animate-in fade-in duration-300">
        <div className="flex flex-col items-center">
          <Logo />
          <h2 className="mt-6 text-2xl font-bold text-foreground">Welcome to Finora</h2>
          <p className="mt-2 text-sm text-muted-foreground text-center">
            To get started, choose a unique username so friends can connect with you. 
            Choose carefully — usernames can't currently be changed.
          </p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Display Name</label>
              <input 
                type="text" 
                placeholder="e.g. Romesh" 
                className="w-full bg-background border border-border/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
              <input 
                type="text" 
                placeholder="e.g. romesh_123" 
                className="w-full bg-background border border-border/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase())}
                disabled={loading}
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
          <button 
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold disabled:opacity-50 transition-opacity mt-4"
          >
            {loading ? 'Setting up...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

