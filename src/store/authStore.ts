import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import { initDbWithMockData } from '../utils/initDb';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  isAuthLoading: boolean;
  lastSyncedAt: number | null;

  setUser: (user: User | null, session: Session | null) => void;
  setAuthLoading: (loading: boolean) => void;
  setLastSyncedAt: (time: number) => void;

  signUp: (email: string, password: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<string | null>;
  deleteAccountData: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  isAuthLoading: true,
  lastSyncedAt: null,

  setUser: (user, session) => set({ user, session }),
  setAuthLoading: (loading) => set({ isAuthLoading: loading }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),

  signUp: async (email, password) => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail.endsWith('@chinookz.33mail.com')) {
      return 'SignUp not allowed please contact Nookz.Inc';
    }
    const { error } = await supabase.auth.signUp({ email: trimmedEmail, password });
    return error?.message ?? null;
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('finora-pending-sync');
    set({ user: null, session: null, lastSyncedAt: null });
    // Clear local user data
    await Promise.all([
      db.accounts.clear(),
      db.transactions.clear(),
      db.budgets.clear(),
      db.tags.clear(),
      db.categories.clear(),
    ]);
    await initDbWithMockData();
  },

  sendPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return error?.message ?? null;
  },

  // Deletes all user data rows from Supabase then signs out.
  // The auth account itself is preserved so they can sign back in.
  deleteAccountData: async () => {
    const user = get().user;
    if (!user) return 'Not logged in.';
    try {
      const tables = ['accounts', 'transactions', 'budgets', 'tags', 'categories'] as const;
      for (const table of tables) {
        const { error } = await supabase.from(table).delete().eq('user_id', user.id);
        if (error) return error.message;
      }
      await supabase.auth.signOut();
      set({ user: null, session: null });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Unknown error';
    }
  },
}));

