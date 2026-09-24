-- ==============================================================================
-- FINORA SUPABASE SCHEMA
-- Run this entire file in your Supabase SQL Editor.
-- All statements use IF NOT EXISTS / DROP POLICY IF EXISTS so re-running is safe.
-- ==============================================================================

-- ==============================================================================
-- SECTION 0: Core Tables (accounts, transactions, budgets, tags, categories)
-- These were missing from earlier schema versions. Add them first.
-- ==============================================================================

-- 0a. Accounts
CREATE TABLE IF NOT EXISTS public.accounts (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bank',
  balance NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'LKR',
  include_in_total BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own accounts" ON public.accounts;
CREATE POLICY "Users can manage their own accounts" ON public.accounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 0b. Transactions
CREATE TABLE IF NOT EXISTS public.transactions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',
  amount NUMERIC NOT NULL,
  date BIGINT NOT NULL,
  account_id TEXT NOT NULL,
  category_id TEXT,
  notes TEXT,
  tag_ids JSONB,
  to_account_id TEXT,
  is_shared BOOLEAN,
  personal_amount NUMERIC,
  is_settled BOOLEAN,
  exclude_from_budget BOOLEAN,
  debt_id TEXT,
  debt_direction TEXT,
  debt_settlement_id TEXT,
  updated_at BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own transactions" ON public.transactions;
CREATE POLICY "Users can manage their own transactions" ON public.transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 0c. Budgets
CREATE TABLE IF NOT EXISTS public.budgets (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  period TEXT NOT NULL DEFAULT 'days',
  period_length INTEGER NOT NULL DEFAULT 1,
  start_date BIGINT NOT NULL,
  end_date BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own budgets" ON public.budgets;
CREATE POLICY "Users can manage their own budgets" ON public.budgets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 0d. Tags
CREATE TABLE IF NOT EXISTS public.tags (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  updated_at BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own tags" ON public.tags;
CREATE POLICY "Users can manage their own tags" ON public.tags
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 0e. Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',
  icon TEXT NOT NULL DEFAULT 'tag',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  updated_at BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own categories" ON public.categories;
CREATE POLICY "Users can manage their own categories" ON public.categories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- SECTION 0f: Auth Hook — Signup Domain Allowlist (server-side enforcement)
-- Blocks signups from domains not in the allowlist at the database level.
-- React-side check is UX only; this is the real gate.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.enforce_signup_domain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Add allowed email domains below. Adjust or remove as needed.
  IF NEW.email NOT LIKE '%@chinookz.33mail.com' THEN
    RAISE EXCEPTION 'SignUp not allowed — please contact Nookz.Inc';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_signup_domain ON auth.users;
CREATE TRIGGER check_signup_domain
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.enforce_signup_domain();

-- ==============================================================================
-- SECTION 1 onwards: Float / Goals / Debts / Recurring (existing tables)
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
  connection_id TEXT,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own people" ON public.people;
CREATE POLICY "Users can manage their own people" ON public.people
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.debts (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  person_id TEXT,
  person_name TEXT NOT NULL DEFAULT 'Friend',
  amount NUMERIC NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  direction TEXT NOT NULL DEFAULT 'theyOweMe',
  note TEXT,
  settlements JSONB DEFAULT '[]'::jsonb,
  related_transaction_id TEXT,
  date BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own debts" ON public.debts;
CREATE POLICY "Users can manage their own debts" ON public.debts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Migration helpers for existing databases
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'theyOweMe';
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS person_name TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS settlements JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.debts ALTER COLUMN person_id DROP NOT NULL;

-- Transaction support for debt settlements
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS debt_id TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS debt_direction TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS debt_settlement_id TEXT;

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

-- ==============================================================================
-- SECTION 12: Realtime Publication Setup
-- Enables instant WebSocket broadcasts across devices for core tables.
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.budgets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tags;
ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
ALTER PUBLICATION supabase_realtime ADD TABLE public.savings_goals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recurring_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.debts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.people;

ALTER TABLE public.accounts REPLICA IDENTITY DEFAULT;
ALTER TABLE public.transactions REPLICA IDENTITY DEFAULT;
ALTER TABLE public.budgets REPLICA IDENTITY DEFAULT;
ALTER TABLE public.tags REPLICA IDENTITY DEFAULT;
ALTER TABLE public.categories REPLICA IDENTITY DEFAULT;



-- Phase 2A: Shared IOUs
-- Migration script for existing production deployments.

-- 1. Table Creation
CREATE TABLE IF NOT EXISTS public.shared_ious (
  id TEXT PRIMARY KEY,
  creator_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
  creditor_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
  debtor_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3,5}$'),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 255),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'settled')),
  created_at BIGINT NOT NULL,
  accepted_at BIGINT,
  updated_at BIGINT NOT NULL,

  -- V1 Invariants
  CONSTRAINT creator_is_creditor CHECK (creator_id = creditor_id),
  CONSTRAINT different_users CHECK (creditor_id != debtor_id)
);

-- 2. Table Privileges
-- Explicitly revoke direct write access from clients
REVOKE ALL ON public.shared_ious FROM PUBLIC;
REVOKE ALL ON public.shared_ious FROM anon;
REVOKE ALL ON public.shared_ious FROM authenticated;
GRANT SELECT ON public.shared_ious TO authenticated;

-- 3. Row Level Security
ALTER TABLE public.shared_ious ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own shared IOUs" ON public.shared_ious;
CREATE POLICY "Users can read own shared IOUs" ON public.shared_ious
  FOR SELECT USING (auth.uid() = creditor_id OR auth.uid() = debtor_id);

-- 4. RPCs

-- CREATE
CREATE OR REPLACE FUNCTION create_shared_iou(
  p_debtor_id UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_description TEXT DEFAULT NULL
) RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_conn_status TEXT;
  v_norm_currency TEXT := upper(trim(p_currency));
  v_norm_desc TEXT := NULLIF(trim(p_description), '');
  v_iou_id TEXT;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_debtor_id IS NULL THEN RAISE EXCEPTION 'invalid_debtor'; END IF;
  IF v_uid = p_debtor_id THEN RAISE EXCEPTION 'cannot_create_with_self'; END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  IF v_norm_currency !~ '^[A-Z]{3,5}$' THEN
    RAISE EXCEPTION 'invalid_currency';
  END IF;

  IF v_norm_desc IS NOT NULL AND char_length(v_norm_desc) > 255 THEN
    RAISE EXCEPTION 'description_too_long';
  END IF;

  -- Connection check
  SELECT status INTO v_conn_status FROM public.connections
  WHERE user_a = least(v_uid, p_debtor_id) AND user_b = greatest(v_uid, p_debtor_id);

  IF v_conn_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'connection_not_accepted';
  END IF;

  v_iou_id := 'iou_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.shared_ious (
    id, creator_id, creditor_id, debtor_id,
    amount, currency, description, status,
    created_at, accepted_at, updated_at
  ) VALUES (
    v_iou_id, v_uid, v_uid, p_debtor_id,
    p_amount, v_norm_currency, v_norm_desc, 'pending',
    v_now, NULL, v_now
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$func$;

-- ACCEPT
CREATE OR REPLACE FUNCTION accept_shared_iou(p_iou_id TEXT)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  UPDATE public.shared_ious
  SET status = 'accepted', accepted_at = v_now, updated_at = v_now
  WHERE id = p_iou_id
    AND status = 'pending'
    AND debtor_id = v_uid
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_state_transition';
  END IF;

  RETURN v_result;
END;
$func$;

-- DECLINE
CREATE OR REPLACE FUNCTION decline_shared_iou(p_iou_id TEXT)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  UPDATE public.shared_ious
  SET status = 'declined', updated_at = v_now
  WHERE id = p_iou_id
    AND status = 'pending'
    AND debtor_id = v_uid
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_state_transition';
  END IF;

  RETURN v_result;
END;
$func$;

-- CANCEL
CREATE OR REPLACE FUNCTION cancel_shared_iou(p_iou_id TEXT)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  UPDATE public.shared_ious
  SET status = 'cancelled', updated_at = v_now
  WHERE id = p_iou_id
    AND status = 'pending'
    AND creditor_id = v_uid
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_state_transition';
  END IF;

  RETURN v_result;
END;
$func$;

-- RPC Privileges
REVOKE EXECUTE ON FUNCTION create_shared_iou(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_shared_iou(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION accept_shared_iou(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_shared_iou(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION decline_shared_iou(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decline_shared_iou(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION cancel_shared_iou(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_shared_iou(TEXT) TO authenticated;


-- Phase 3A: Shared IOU Settlements

-- 1. Table Creation
CREATE TABLE IF NOT EXISTS public.shared_iou_settlements (
  id TEXT PRIMARY KEY,
  shared_iou_id TEXT REFERENCES public.shared_ious(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  proposed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
  created_at BIGINT NOT NULL,
  confirmed_at BIGINT,
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_shared_iou_settlements_iou_id ON public.shared_iou_settlements(shared_iou_id);

-- 3. Table Privileges
REVOKE ALL ON public.shared_iou_settlements FROM PUBLIC;
REVOKE ALL ON public.shared_iou_settlements FROM anon;
REVOKE ALL ON public.shared_iou_settlements FROM authenticated;
GRANT SELECT ON public.shared_iou_settlements TO authenticated;

-- 4. Row Level Security
ALTER TABLE public.shared_iou_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read settlements for their shared IOUs" ON public.shared_iou_settlements;
CREATE POLICY "Users can read settlements for their shared IOUs" ON public.shared_iou_settlements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shared_ious iou
      WHERE iou.id = shared_iou_settlements.shared_iou_id
      AND (iou.creditor_id = auth.uid() OR iou.debtor_id = auth.uid())
    )
  );

-- 5. RPCs

-- PROPOSE PAYMENT
CREATE OR REPLACE FUNCTION propose_iou_payment(
  p_iou_id TEXT,
  p_amount NUMERIC
) RETURNS public.shared_iou_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_parent_iou public.shared_ious;
  v_confirmed_total NUMERIC;
  v_pending_total NUMERIC;
  v_available_to_propose NUMERIC;
  v_settlement_id TEXT;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_iou_settlements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  -- Lock parent IOU to prevent concurrent state changes
  SELECT * INTO v_parent_iou FROM public.shared_ious WHERE id = p_iou_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;
  IF v_parent_iou.status != 'accepted' THEN RAISE EXCEPTION 'invalid_iou_status'; END IF;
  IF v_uid != v_parent_iou.debtor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Calculate reserved amounts
  SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_total FROM public.shared_iou_settlements WHERE shared_iou_id = p_iou_id AND status = 'confirmed';
  SELECT COALESCE(SUM(amount), 0) INTO v_pending_total FROM public.shared_iou_settlements WHERE shared_iou_id = p_iou_id AND status = 'pending';

  v_available_to_propose := v_parent_iou.amount - v_confirmed_total - v_pending_total;

  IF p_amount > v_available_to_propose THEN
    RAISE EXCEPTION 'amount_exceeds_available';
  END IF;

  v_settlement_id := 'stl_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.shared_iou_settlements (
    id, shared_iou_id, amount, proposed_by, status, created_at
  ) VALUES (
    v_settlement_id, p_iou_id, p_amount, v_uid, 'pending', v_now
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$func$;

-- CONFIRM PAYMENT
CREATE OR REPLACE FUNCTION confirm_iou_payment(
  p_settlement_id TEXT
) RETURNS public.shared_iou_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_settlement public.shared_iou_settlements;
  v_parent_iou public.shared_ious;
  v_confirmed_total NUMERIC;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_iou_settlements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  -- First, get the settlement to find the parent IOU
  SELECT * INTO v_settlement FROM public.shared_iou_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_settlement.status != 'pending' THEN RAISE EXCEPTION 'settlement_not_pending'; END IF;

  -- Lock parent IOU
  SELECT * INTO v_parent_iou FROM public.shared_ious WHERE id = v_settlement.shared_iou_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;
  IF v_uid != v_parent_iou.creditor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_parent_iou.status != 'accepted' THEN RAISE EXCEPTION 'invalid_iou_status'; END IF;

  -- Recalculate confirmed total safely under lock
  SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_total FROM public.shared_iou_settlements WHERE shared_iou_id = v_parent_iou.id AND status = 'confirmed';

  IF v_confirmed_total + v_settlement.amount > v_parent_iou.amount THEN
    RAISE EXCEPTION 'over_settlement';
  END IF;

  -- Confirm the settlement
  UPDATE public.shared_iou_settlements
  SET status = 'confirmed', confirmed_at = v_now, confirmed_by = v_uid
  WHERE id = p_settlement_id
  RETURNING * INTO v_result;

  -- Transition parent if fully settled
  IF v_confirmed_total + v_settlement.amount = v_parent_iou.amount THEN
    UPDATE public.shared_ious SET status = 'settled', updated_at = v_now WHERE id = v_parent_iou.id;
  END IF;

  RETURN v_result;
END;
$func$;

-- REJECT PAYMENT
CREATE OR REPLACE FUNCTION reject_iou_payment(
  p_settlement_id TEXT
) RETURNS public.shared_iou_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_settlement public.shared_iou_settlements;
  v_parent_iou public.shared_ious;
  v_result public.shared_iou_settlements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_settlement FROM public.shared_iou_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_settlement.status != 'pending' THEN RAISE EXCEPTION 'settlement_not_pending'; END IF;

  -- Lock parent IOU
  SELECT * INTO v_parent_iou FROM public.shared_ious WHERE id = v_settlement.shared_iou_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;
  IF v_uid != v_parent_iou.creditor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Reject the settlement
  UPDATE public.shared_iou_settlements
  SET status = 'rejected'
  WHERE id = p_settlement_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$func$;

-- 6. RPC Privileges
REVOKE EXECUTE ON FUNCTION propose_iou_payment(TEXT, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION propose_iou_payment(TEXT, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION propose_iou_payment(TEXT, NUMERIC) TO authenticated;

REVOKE EXECUTE ON FUNCTION confirm_iou_payment(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION confirm_iou_payment(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_iou_payment(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION reject_iou_payment(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_iou_payment(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION reject_iou_payment(TEXT) TO authenticated;
