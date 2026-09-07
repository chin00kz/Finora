-- ==============================================================================
-- FINORA SUPABASE SCHEMA: ADVANCED TABLES SETUP
-- Run this in your Supabase SQL Editor to enable full two-way cloud sync for:
-- - Recurring Transactions
-- - Savings Goals
-- - People & Debts (IOUs)
-- - Credit Cards & Float Management Module
-- ==============================================================================

-- 1. Recurring Transactions
CREATE TABLE IF NOT EXISTS public.recurring_transactions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  account_id TEXT NOT NULL,
  category_id TEXT,
  frequency TEXT NOT NULL,
  next_due_date BIGINT NOT NULL,
  type TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own recurring transactions" ON public.recurring_transactions;
CREATE POLICY "Users can manage their own recurring transactions" ON public.recurring_transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Savings Goals
CREATE TABLE IF NOT EXISTS public.savings_goals (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  target_amount NUMERIC NOT NULL,
  current_amount NUMERIC NOT NULL DEFAULT 0,
  target_date BIGINT,
  linked_account_id TEXT,
  color TEXT,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own savings goals" ON public.savings_goals;
CREATE POLICY "Users can manage their own savings goals" ON public.savings_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. People & Debts (IOUs)
CREATE TABLE IF NOT EXISTS public.people (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own people" ON public.people;
CREATE POLICY "Users can manage their own people" ON public.people
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.debts (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  person_id TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  related_transaction_id TEXT,
  date BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own debts" ON public.debts;
CREATE POLICY "Users can manage their own debts" ON public.debts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Credit Cards
CREATE TABLE IF NOT EXISTS public.credit_cards (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  credit_limit NUMERIC NOT NULL,
  current_balance NUMERIC NOT NULL DEFAULT 0,
  apr_percent NUMERIC NOT NULL DEFAULT 0,
  grace_min_days INTEGER NOT NULL DEFAULT 0,
  grace_max_days INTEGER NOT NULL DEFAULT 0,
  due_date BIGINT NOT NULL,
  cycle_start_day INTEGER NOT NULL DEFAULT 1,
  is_secured_against TEXT,
  pay_in_full_intent BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own credit cards" ON public.credit_cards;
CREATE POLICY "Users can manage their own credit cards" ON public.credit_cards
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. Cash Offset Sources
CREATE TABLE IF NOT EXISTS public.cash_offset_sources (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  linked_card_id TEXT NOT NULL,
  expected_monthly_amount NUMERIC NOT NULL,
  category TEXT,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.cash_offset_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own cash offset sources" ON public.cash_offset_sources;
CREATE POLICY "Users can manage their own cash offset sources" ON public.cash_offset_sources
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. Fixed Deposits
CREATE TABLE IF NOT EXISTS public.fixed_deposits (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  principal NUMERIC NOT NULL,
  rate_percent NUMERIC NOT NULL,
  maturity_interval_months INTEGER NOT NULL,
  linked_card_id TEXT,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.fixed_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own fixed deposits" ON public.fixed_deposits;
CREATE POLICY "Users can manage their own fixed deposits" ON public.fixed_deposits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. Money Market Accounts
CREATE TABLE IF NOT EXISTS public.money_market_accounts (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  balance NUMERIC NOT NULL,
  current_rate_percent NUMERIC NOT NULL,
  minimum_balance_for_rate NUMERIC NOT NULL DEFAULT 0,
  base_rate_percent NUMERIC NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.money_market_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own MMAs" ON public.money_market_accounts;
CREATE POLICY "Users can manage their own MMAs" ON public.money_market_accounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 8. Installment Plans
CREATE TABLE IF NOT EXISTS public.installment_plans (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  linked_card_id TEXT NOT NULL,
  description TEXT NOT NULL,
  total_amount NUMERIC NOT NULL,
  monthly_amount NUMERIC NOT NULL,
  total_months INTEGER NOT NULL,
  months_paid INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own installment plans" ON public.installment_plans;
CREATE POLICY "Users can manage their own installment plans" ON public.installment_plans
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 9. Card Promos
CREATE TABLE IF NOT EXISTS public.card_promos (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  linked_card_id TEXT NOT NULL,
  description TEXT NOT NULL,
  spend_threshold NUMERIC NOT NULL DEFAULT 0,
  min_transaction_count INTEGER NOT NULL DEFAULT 0,
  window_start BIGINT NOT NULL,
  window_end BIGINT NOT NULL,
  cashback_percent NUMERIC NOT NULL DEFAULT 0,
  cashback_cap NUMERIC NOT NULL DEFAULT 0,
  current_spend NUMERIC NOT NULL DEFAULT 0,
  current_transaction_count INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.card_promos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own promos" ON public.card_promos;
CREATE POLICY "Users can manage their own promos" ON public.card_promos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 10. Float Gap History
CREATE TABLE IF NOT EXISTS public.float_gap_history (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  card_id TEXT NOT NULL,
  cycle_label TEXT NOT NULL,
  total_bill NUMERIC NOT NULL,
  cash_received NUMERIC NOT NULL,
  delta NUMERIC NOT NULL,
  cumulative_gap NUMERIC NOT NULL,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.float_gap_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own float gap history" ON public.float_gap_history;
CREATE POLICY "Users can manage their own float gap history" ON public.float_gap_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 11. Reimbursement Ledgers & Entries
CREATE TABLE IF NOT EXISTS public.reimbursement_ledgers (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  counterparty_name TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.reimbursement_ledgers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own ledgers" ON public.reimbursement_ledgers;
CREATE POLICY "Users can manage their own ledgers" ON public.reimbursement_ledgers
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.reimbursement_entries (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ledger_id TEXT NOT NULL,
  date BIGINT NOT NULL,
  note TEXT,
  amount_owed NUMERIC NOT NULL,
  amount_paid NUMERIC NOT NULL,
  delta NUMERIC NOT NULL,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.reimbursement_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own reimbursement entries" ON public.reimbursement_entries;
CREATE POLICY "Users can manage their own reimbursement entries" ON public.reimbursement_entries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

