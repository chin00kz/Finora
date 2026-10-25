-- ==============================================================================
-- Choice A batch 01: meta, operations ledger, dataset_epoch columns
-- DO NOT APPLY until explicitly approved. Staging and production share this DB.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.personal_dataset_meta (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL DEFAULT 0,
  last_replaced_at TIMESTAMPTZ,
  last_operation_id TEXT,
  last_cloud_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.personal_dataset_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_cloud_fingerprint TEXT NOT NULL,
  local_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'failed', 'aborted_stale')),
  error TEXT,
  cloud_fingerprint_after TEXT,
  epoch_after BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ,
  UNIQUE (user_id, client_operation_id)
);

CREATE INDEX IF NOT EXISTS idx_personal_dataset_operations_user
  ON public.personal_dataset_operations (user_id, created_at DESC);

ALTER TABLE public.personal_dataset_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_dataset_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own dataset meta" ON public.personal_dataset_meta;
CREATE POLICY "Users can read own dataset meta" ON public.personal_dataset_meta
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own dataset operations" ON public.personal_dataset_operations;
CREATE POLICY "Users can read own dataset operations" ON public.personal_dataset_operations
  FOR SELECT USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated — only SECURITY DEFINER RPCs mutate.

REVOKE ALL ON public.personal_dataset_meta FROM PUBLIC;
REVOKE ALL ON public.personal_dataset_meta FROM anon;
REVOKE ALL ON public.personal_dataset_meta FROM authenticated;
GRANT SELECT ON public.personal_dataset_meta TO authenticated;

REVOKE ALL ON public.personal_dataset_operations FROM PUBLIC;
REVOKE ALL ON public.personal_dataset_operations FROM anon;
REVOKE ALL ON public.personal_dataset_operations FROM authenticated;
GRANT SELECT ON public.personal_dataset_operations TO authenticated;

-- Additive epoch column (default 0) — legacy clients omit it safely while epoch = 0.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.savings_goals ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.credit_cards ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.cash_offset_sources ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.fixed_deposits ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.money_market_accounts ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.installment_plans ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.card_promos ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.float_gap_history ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.reimbursement_ledgers ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.reimbursement_entries ADD COLUMN IF NOT EXISTS dataset_epoch BIGINT NOT NULL DEFAULT 0;
