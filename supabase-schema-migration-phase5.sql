-- Phase 5 Shared Expenses Migration
-- NOT YET APPLIED


-- 0. Groups Table (Personal Sync)
CREATE TABLE IF NOT EXISTS public.groups (
    id text NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name text NOT NULL,
    participant_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own groups"
    ON public.groups
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Make sure real-time replication works for groups if needed by personal sync
alter publication supabase_realtime add table public.groups;

-- 1. Create shared_payments table for first-class relationship payments
CREATE TABLE IF NOT EXISTS public.shared_payments (
    id uuid NOT NULL PRIMARY KEY,
    creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount numeric NOT NULL CHECK (amount > 0),
    currency text NOT NULL DEFAULT 'LKR',
    status text NOT NULL DEFAULT 'pending', -- pending, confirmed, rejected
    idempotency_key text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    rejected_at timestamptz
);

-- RLS for shared_payments
ALTER TABLE public.shared_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their shared_payments"
    ON public.shared_payments FOR SELECT
    USING (auth.uid() = creator_id OR auth.uid() = recipient_id);

-- Only RPCs can insert/update
CREATE POLICY "Users can insert shared_payments via RPC"
    ON public.shared_payments FOR INSERT
    WITH CHECK (auth.uid() = creator_id);

-- 2. Bulk Propose Shared IOUs (Outbox RPC)
CREATE OR REPLACE FUNCTION public.propose_shared_ious_bulk(payload JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    creator_uuid uuid;
    split JSONB;
BEGIN
    creator_uuid := auth.uid();
    IF creator_uuid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- payload shape: { transaction_id: 'txn-123', splits: [{ id, debtor_id, amount, description }] }
    
    FOR split IN SELECT * FROM jsonb_array_elements(payload->'splits')
    LOOP
        -- Validate connection exists and is accepted
        IF NOT EXISTS (
            SELECT 1 FROM public.connections c
            WHERE c.status = 'accepted'
              AND ((c.user_a = creator_uuid AND c.user_b = (split->>'debtor_id')::uuid)
                OR (c.user_b = creator_uuid AND c.user_a = (split->>'debtor_id')::uuid))
        ) THEN
            RAISE EXCEPTION 'No active connection with %', split->>'debtor_id';
        END IF;

        -- Insert idempotent
        INSERT INTO public.shared_ious (
            id, creator_id, creditor_id, debtor_id, amount, currency, description, status, updated_at
        ) VALUES (
            (split->>'id')::uuid,
            creator_uuid,
            creator_uuid,
            (split->>'debtor_id')::uuid,
            (split->>'amount')::numeric,
            'LKR',
            split->>'description',
            'pending',
            now()
        ) ON CONFLICT (id) DO NOTHING;
    END LOOP;
END;
$$;

-- 3. Cancel Shared IOUs Bulk (Pre-consensus)
CREATE OR REPLACE FUNCTION public.cancel_shared_iou_bulk(payload JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    creator_uuid uuid;
    split_id text;
BEGIN
    creator_uuid := auth.uid();
    IF creator_uuid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- payload shape: { ids: ['uuid-1', 'uuid-2'] }
    
    FOR split_id IN SELECT * FROM jsonb_array_elements_text(payload->'ids')
    LOOP
        -- Lock and check status
        -- Only delete if still pending
        DELETE FROM public.shared_ious
        WHERE id = split_id::uuid
          AND creator_id = creator_uuid
          AND status = 'pending';
    END LOOP;
END;
$$;
