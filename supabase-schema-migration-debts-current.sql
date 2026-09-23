-- Migration: Upgrade legacy debts table to current canonical schema

-- 1. Safely add missing columns
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS direction TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS person_name TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS settlements JSONB;

-- 2. Backfill existing rows strictly using historical Dexie v7 upgrade logic
UPDATE public.debts
SET 
  direction = COALESCE(direction, CASE WHEN amount >= 0 THEN 'theyOweMe' ELSE 'iOweThem' END),
  amount = ABS(amount),
  source = COALESCE(source, CASE WHEN related_transaction_id IS NOT NULL THEN 'shared_expense' ELSE 'manual' END),
  settlements = COALESCE(settlements, '[]'::jsonb),
  person_name = COALESCE(person_name, (
    SELECT name FROM public.people p WHERE p.id = public.debts.person_id
  ), 'Friend')
WHERE direction IS NULL OR source IS NULL OR person_name IS NULL OR settlements IS NULL;

-- 3. Apply DEFAULT constraints
ALTER TABLE public.debts ALTER COLUMN direction SET DEFAULT 'theyOweMe';
ALTER TABLE public.debts ALTER COLUMN source SET DEFAULT 'manual';
ALTER TABLE public.debts ALTER COLUMN person_name SET DEFAULT 'Friend';
ALTER TABLE public.debts ALTER COLUMN settlements SET DEFAULT '[]'::jsonb;

-- 4. Apply NOT NULL constraints to match canonical CREATE TABLE exactly
ALTER TABLE public.debts ALTER COLUMN direction SET NOT NULL;
ALTER TABLE public.debts ALTER COLUMN source SET NOT NULL;
ALTER TABLE public.debts ALTER COLUMN person_name SET NOT NULL;
-- (Note: 'settlements' does not have a NOT NULL constraint in the canonical schema)

-- 5. Drop NOT NULL constraint on person_id (it is optional in the modern app)
ALTER TABLE public.debts ALTER COLUMN person_id DROP NOT NULL;
