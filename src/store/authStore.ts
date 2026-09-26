import { useUIStore } from './uiStore';
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import { ALL_TABLES, clearSyncLocalState } from '../sync/syncEngine';
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

// Map of TableName → the Dexie collection for that table
// Used by signOut to clear all local data without an explicit list
const DEXIE_TABLES: Record<string, () => Promise<void>> = {
  accounts: () => db.accounts.clear(),
  transactions: () => db.transactions.clear(),
  budgets: () => db.budgets.clear(),
  tags: () => db.tags.clear(),
  categories: () => db.categories.clear(),
  recurring_transactions: () => db.recurringTransactions.clear(),
  savings_goals: () => db.savingsGoals.clear(),
  people: () => db.people.clear(),
  debts: () => db.debts.clear(),
  credit_cards: () => db.creditCards.clear(),
  cash_offset_sources: () => db.cashOffsetSources.clear(),
  fixed_deposits: () => db.fixedDeposits.clear(),
  money_market_accounts: () => db.moneyMarketAccounts.clear(),
  installment_plans: () => db.installmentPlans.clear(),
  card_promos: () => db.cardPromos.clear(),
  float_gap_history: () => db.floatGapHistory.clear(),
  reimbursement_ledgers: () => db.reimbursementLedgers.clear(),
  reimbursement_entries: () => db.reimbursementEntries.clear(),
  groups: () => db.groups.clear(),
};

async function wipeLocalUserData(): Promise<void> {
  clearSyncLocalState();
  await Promise.all(ALL_TABLES.map(t => DEXIE_TABLES[t]?.()));
  await Promise.all([
    db.cacheProfiles.clear(),
    db.cacheConnections.clear(),
    db.cacheSharedIous.clear(),
    db.cacheSharedIouSettlements.clear(),
    db.cacheNotifications.clear(),
    db.sharedOutbox.clear(),
    db.sharedPayments.clear(),
    db.transactionProvenance.clear(),
  ]);
  useUIStore.getState().resetProfileIntroState();
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
    set({ user: null, session: null, lastSyncedAt: null });
    await wipeLocalUserData();
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
      for (const table of ALL_TABLES) {
        const { error } = await supabase.from(table).delete().eq('user_id', user.id);
        if (error && !error.message.includes('does not exist') && !error.message.includes('schema cache')) {
          return error.message;
        }
      }
      await supabase.auth.signOut();
      set({ user: null, session: null, lastSyncedAt: null });
      await wipeLocalUserData();
      return null;
      } catch (err) {
      return err instanceof Error ? err.message : 'Unknown error';
    }
  },
}));





