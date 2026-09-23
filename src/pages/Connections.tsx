import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import { Search, Check, X, Clock, ArrowLeft } from 'lucide-react';
import { db } from '../db/db';
import type { CacheProfile, CacheConnection, Person } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';

export default function Connections() {
  const { user } = useAuthStore();
  const [profile, setProfile] = useState<CacheProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFriendId, setExpandedFriendId] = useState<string | null>(null);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{ id: string, username: string, display_name: string } | null>(null);
  const [searchError, setSearchError] = useState('');

  // Local Cache
  const cachedConnections = useLiveQuery(() => db.cacheConnections.toArray()) || [];
  const cachedProfiles = useLiveQuery(() => db.cacheProfiles.toArray()) || [];
  const people = useLiveQuery(() => db.people.toArray()) || [];

  useEffect(() => {
    if (user) {
      loadProfile();
      fetchConnections();
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

  const fetchConnections = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.rpc('get_my_connections');
      if (error) throw error;
      
      if (data) {
        const conns: CacheConnection[] = [];
        const profs: CacheProfile[] = [];
        
        data.forEach((row: any) => {
          if (row.status === 'declined') return;
          conns.push({
            id: row.connection_id,
            user_a: user.id,
            user_b: row.other_user_id,
            status: row.status,
            action_user_id: row.action_user_id,
            created_at: 0,
            updatedAt: Date.now()
          });
          
          profs.push({
            id: row.other_user_id,
            username: row.other_username,
            display_name: row.other_display_name,
            updatedAt: Date.now()
          });
        });
        
        await db.cacheConnections.clear();
        if (conns.length > 0) await db.cacheConnections.bulkPut(conns);
        if (profs.length > 0) await db.cacheProfiles.bulkPut(profs);
      }
    } catch (e) {
      console.warn("Failed to fetch connections", e);
    }
  };

  const handleSearch = async () => {
    setSearchError('');
    setSearchResult(null);
    if (!searchQuery.trim()) return;
    
    try {
      const { data, error } = await supabase.rpc('get_profile_by_username', { search_username: searchQuery.trim().toLowerCase() });
      if (error) throw error;
      if (data && data.length > 0) {
        setSearchResult(data[0]);
      } else {
        setSearchError('User not found.');
      }
    } catch (e: any) {
      setSearchError(e.message || 'Error searching user.');
    }
  };

  const handleSendRequest = async (targetId: string) => {
    try {
      const { error } = await supabase.rpc('send_connection_request', { target_user_id: targetId });
      if (error) throw error;
      setSearchResult(null);
      setSearchQuery('');
      await fetchConnections();
    } catch (e: any) {
      setSearchError(e.message || 'Failed to send request.');
    }
  };

  const handleRespond = async (connId: string, status: 'accepted' | 'declined') => {
    try {
      const { error } = await supabase.rpc('respond_connection_request', { conn_id: connId, response_status: status });
      if (error) throw error;
      await fetchConnections();
    } catch (e: any) {
      console.error(e);
    }
  };

  if (!user) return (
    <div className="flex-1 w-full max-w-md mx-auto relative pb-24 md:pb-8 pt-6 px-4">
      <p className="text-center text-muted-foreground">Please sign in to use social features.</p>
    </div>
  );
  
  if (loading) return null;

  if (!profile) {
    return (
      <div className="flex-1 w-full max-w-md mx-auto relative pb-24 md:pb-8 pt-6 px-4 space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-2 -ml-2 rounded-full hover:bg-muted text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Friends & Connections</h1>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-6 text-center space-y-4">
          <p className="text-muted-foreground text-sm">You need a Finora Profile to connect with friends.</p>
          <Link to="/settings" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-xl font-medium text-sm">
            Go to Settings
          </Link>
        </div>
      </div>
    );
  }

  const incomingReqs = cachedConnections.filter(c => c.status === 'pending' && c.action_user_id !== user.id);
  const outgoingReqs = cachedConnections.filter(c => c.status === 'pending' && c.action_user_id === user.id);
  const friends = cachedConnections.filter(c => c.status === 'accepted');
  const searchResultConn = searchResult ? cachedConnections.find(c => c.user_b === searchResult.id || c.user_a === searchResult.id) : null;
  
  return (
    <div className="flex-1 w-full max-w-md mx-auto relative pb-24 md:pb-8 pt-6 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="p-2 -ml-2 rounded-full hover:bg-muted text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Friends & Connections</h1>
      </div>

      {/* Find People */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Find People</h4>
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="Search by @username..." 
            className="flex-1 bg-background border border-border/50 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch} className="px-4 bg-secondary text-secondary-foreground rounded-xl flex items-center justify-center">
            <Search className="w-4 h-4" />
          </button>
        </div>
        {searchError && <p className="text-sm text-red-500 px-1">{searchError}</p>}
        {searchResult && (
          <div className="flex items-center justify-between bg-card p-3 rounded-xl border border-border/50">
            <div>
              <p className="font-medium text-sm text-foreground">{searchResult.display_name}</p>
              <p className="text-xs text-muted-foreground">@{searchResult.username}</p>
            </div>
            {!searchResultConn ? (
              <button onClick={() => handleSendRequest(searchResult.id)} className="text-xs px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium">Connect</button>
            ) : searchResultConn.status === 'accepted' ? (
              <span className="text-xs px-3 py-1.5 bg-green-500/10 text-green-500 rounded-lg font-medium">Connected</span>
            ) : searchResultConn.action_user_id === user.id ? (
              <span className="text-xs px-3 py-1.5 bg-secondary text-muted-foreground rounded-lg flex items-center gap-1.5"><Clock className="w-3 h-3"/> Pending</span>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => handleRespond(searchResultConn.id, 'accepted')} className="p-2 bg-primary text-primary-foreground rounded-lg"><Check className="w-4 h-4"/></button>
                <button onClick={() => handleRespond(searchResultConn.id, 'declined')} className="p-2 bg-secondary text-secondary-foreground rounded-lg"><X className="w-4 h-4"/></button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Requests */}
      {(incomingReqs.length > 0 || outgoingReqs.length > 0) && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Requests</h4>
          {incomingReqs.map((conn: CacheConnection) => {
            const otherProf = cachedProfiles.find((p: CacheProfile) => p.id === conn.user_b);
            if (!otherProf) return null;
            return (
              <div key={conn.id} className="flex items-center justify-between p-3 rounded-xl bg-card border border-border/50">
                <div>
                  <p className="font-medium text-sm text-foreground">{otherProf.display_name}</p>
                  <p className="text-xs text-muted-foreground">@{otherProf.username} <span className="text-primary font-medium">(Incoming)</span></p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleRespond(conn.id, 'accepted')} className="px-4 py-2 bg-primary text-primary-foreground text-xs rounded-lg font-medium">Accept</button>
                  <button onClick={() => handleRespond(conn.id, 'declined')} className="px-4 py-2 bg-secondary text-secondary-foreground text-xs rounded-lg font-medium">Decline</button>
                </div>
              </div>
            );
          })}
          {outgoingReqs.map((conn: CacheConnection) => {
            const otherProf = cachedProfiles.find((p: CacheProfile) => p.id === conn.user_b);
            if (!otherProf) return null;
            return (
              <div key={conn.id} className="flex items-center justify-between p-3 rounded-xl bg-card border border-border/50 opacity-80">
                <div>
                  <p className="font-medium text-sm text-foreground">{otherProf.display_name}</p>
                  <p className="text-xs text-muted-foreground">@{otherProf.username}</p>
                </div>
                <span className="text-xs px-3 py-1.5 bg-secondary text-muted-foreground rounded-lg flex items-center gap-1.5"><Clock className="w-3 h-3"/> Pending</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Friends */}
      {friends.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Friends</h4>
          <div className="space-y-2">
            {friends.map((conn: CacheConnection) => {
              const otherProf = cachedProfiles.find((p: CacheProfile) => p.id === conn.user_b);
              if (!otherProf) return null;
              return (
                <div key={conn.id} className="flex flex-col gap-3 p-3 rounded-xl bg-card border border-border/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-foreground">{otherProf.display_name}</p>
                      <p className="text-xs text-muted-foreground">@{otherProf.username}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setExpandedFriendId(expandedFriendId === conn.id ? null : conn.id)}
                        className="text-[11px] px-2 py-1 bg-secondary text-secondary-foreground rounded font-medium hover:bg-secondary/80"
                      >
                        {expandedFriendId === conn.id ? 'Close' : 'Link Person...'}
                      </button>
                      <span className="text-xs px-3 py-1 bg-green-500/10 text-green-500 rounded-md font-medium">Connected</span>
                    </div>
                  </div>
                  {expandedFriendId === conn.id && (<div className="pt-2 border-t border-border/50 animate-in slide-in-from-top-2 duration-200">
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Link local Person record (optional)</label>
                    <select 
                      className="w-full bg-background text-sm text-foreground border border-border/50 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                      value={people.find((p: Person) => p.connection_id === conn.id)?.id || ''}
                      onChange={async (e) => {
                        const personId = e.target.value;
                        if (!personId) {
                          const linkedPerson = people.find((p: Person) => p.connection_id === conn.id);
                          if (linkedPerson) await db.people.update(linkedPerson.id, { connection_id: undefined });
                        } else {
                          await db.people.update(personId, { connection_id: conn.id });
                        }
                      }}
                    >
                      <option value="">Match Person / Link existing person...</option>
                      {people.map((p: Person) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

