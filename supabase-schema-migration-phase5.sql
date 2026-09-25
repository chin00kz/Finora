
-- ==============================================================================
-- PHASE 5: SHARED EXPENSES / SPLITS & RELATIONSHIP PAYMENTS
-- ==============================================================================

-- 1. Operation Idempotency Table
CREATE TABLE IF NOT EXISTS public.operation_idempotency (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    operation_type text NOT NULL,
    payload_hash text NOT NULL,
    created_at bigint NOT NULL,
    PRIMARY KEY (user_id, idempotency_key)
);
ALTER TABLE public.operation_idempotency ENABLE ROW LEVEL SECURITY;

-- 2. Groups Table (V1 Personal Sync)
CREATE TABLE IF NOT EXISTS public.groups (
    id text NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name text NOT NULL,
    participants text[] NOT NULL DEFAULT '{}',
    is_deleted boolean NOT NULL DEFAULT false,
    updated_at bigint NOT NULL
);
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own groups" ON public.groups FOR ALL USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
REVOKE ALL ON public.groups FROM anon, PUBLIC;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'groups'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
    END IF;
END $$;


-- 3. Shared Payments Table
CREATE TABLE IF NOT EXISTS public.shared_payments (
    id text PRIMARY KEY,
    idempotency_key text NOT NULL,
    payer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    payee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount numeric NOT NULL CHECK (amount > 0),
    currency text NOT NULL DEFAULT 'LKR',
    status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
    notes text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    accepted_at bigint,
    rejected_at bigint,
    UNIQUE(payer_id, idempotency_key)
);
ALTER TABLE public.shared_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payments they are involved in"
    ON public.shared_payments FOR SELECT
    USING (auth.uid() = payer_id OR auth.uid() = payee_id);

CREATE POLICY "No direct insert on shared_payments"
    ON public.shared_payments FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct update on shared_payments"
    ON public.shared_payments FOR UPDATE USING (false);
CREATE POLICY "No direct delete on shared_payments"
    ON public.shared_payments FOR DELETE USING (false);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shared_payments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_payments;
    END IF;
END $$;


-- 4. Propose Shared Payment RPC
CREATE OR REPLACE FUNCTION public.propose_shared_payment(
    p_idempotency_key text,
    p_payee_id uuid,
    p_amount numeric,
    p_currency text,
    p_notes text
)
RETURNS public.shared_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payer_id uuid;
    v_now bigint;
    v_payment public.shared_payments;
    v_idempotency_check uuid;
    v_norm_currency text;
    v_payload_hash text;
    v_existing_hash text;
BEGIN
    v_payer_id := auth.uid();
    IF v_payer_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key required';
    END IF;

    IF v_payer_id = p_payee_id THEN
        RAISE EXCEPTION 'Payer and payee cannot be the same';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be a positive number';
    END IF;
    
    v_norm_currency := upper(trim(COALESCE(NULLIF(trim(p_currency), ''), 'LKR')));

    -- Require accepted connection
    IF NOT EXISTS (
        SELECT 1 FROM public.connections c
        WHERE c.status = 'accepted'
          AND ((c.user_a = v_payer_id AND c.user_b = p_payee_id)
            OR (c.user_b = v_payer_id AND c.user_a = p_payee_id))
    ) THEN
        RAISE EXCEPTION 'No active connection with payee';
    END IF;

    v_now := (extract(epoch from now()) * 1000)::bigint;
    v_payload_hash := md5(p_payee_id::text || '_' || p_amount::text || '_' || v_norm_currency || '_' || COALESCE(trim(p_notes), ''));

    -- Idempotency Check
    INSERT INTO public.operation_idempotency (user_id, idempotency_key, operation_type, payload_hash, created_at)
    VALUES (v_payer_id, p_idempotency_key, 'propose_payment', v_payload_hash, v_now)
    ON CONFLICT (user_id, idempotency_key) DO NOTHING
    RETURNING user_id INTO v_idempotency_check;

    IF v_idempotency_check IS NULL THEN
        -- Verify payload hash matches exactly
        SELECT payload_hash INTO v_existing_hash FROM public.operation_idempotency 
        WHERE user_id = v_payer_id AND idempotency_key = p_idempotency_key;
        
        IF v_existing_hash != v_payload_hash THEN
            RAISE EXCEPTION 'Idempotency conflict: same key used with different payload';
        END IF;
        
        SELECT * INTO v_payment FROM public.shared_payments 
        WHERE payer_id = v_payer_id AND idempotency_key = p_idempotency_key;
        
        RETURN v_payment;
    END IF;

    INSERT INTO public.shared_payments (
        id, idempotency_key, payer_id, payee_id, amount, currency, status, notes, created_at, updated_at
    ) VALUES (
        'pmt_' || replace(gen_random_uuid()::text, '-', ''),
        p_idempotency_key,
        v_payer_id,
        p_payee_id,
        p_amount,
        v_norm_currency,
        'pending',
        p_notes,
        v_now,
        v_now
    ) RETURNING * INTO v_payment;

    -- Notify payee
    INSERT INTO public.notifications (
        id, user_id, actor_id, type, target_id, status, created_at
    ) VALUES (
        'notif_' || replace(gen_random_uuid()::text, '-', ''),
        p_payee_id,
        v_payer_id,
        'shared_payment_received',
        v_payment.id,
        'unread',
        v_now
    );

    RETURN v_payment;
END;
$$;


-- 5. Respond Shared Payment RPC
CREATE OR REPLACE FUNCTION public.respond_shared_payment(
    p_payment_id text,
    p_accept boolean
)
RETURNS public.shared_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payee_id uuid;
    v_payment public.shared_payments;
    v_now bigint;
    v_remaining_amount numeric;
    v_iou public.shared_ious;
    v_iou_remaining numeric;
    v_allocate numeric;
    v_settlements_sum numeric;
    v_accumulated_owed numeric := 0;
BEGIN
    v_payee_id := auth.uid();
    IF v_payee_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_now := (extract(epoch from now()) * 1000)::bigint;

    -- Lock the payment
    SELECT * INTO v_payment FROM public.shared_payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found';
    END IF;
    IF v_payment.payee_id != v_payee_id THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    IF v_payment.status != 'pending' THEN
        RAISE EXCEPTION 'Payment is not pending';
    END IF;

    IF NOT p_accept THEN
        UPDATE public.shared_payments
        SET status = 'rejected', updated_at = v_now, rejected_at = v_now
        WHERE id = p_payment_id
        RETURNING * INTO v_payment;

        INSERT INTO public.notifications (
            id, user_id, actor_id, type, target_id, status, created_at
        ) VALUES (
            'notif_' || replace(gen_random_uuid()::text, '-', ''),
            v_payment.payer_id,
            v_payee_id,
            'shared_payment_rejected',
            v_payment.id,
            'unread',
            v_now
        );
        RETURN v_payment;
    END IF;

    v_remaining_amount := v_payment.amount;

    -- Secure Row-Lock Loop
    -- Currency must explicitly match
    FOR v_iou IN 
        SELECT * FROM public.shared_ious 
        WHERE status = 'accepted'
          AND creditor_id = v_payee_id
          AND debtor_id = v_payment.payer_id
          AND currency = v_payment.currency
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
    LOOP
        SELECT COALESCE(SUM(amount), 0) INTO v_settlements_sum
        FROM public.shared_iou_settlements
        WHERE shared_iou_id = v_iou.id AND status = 'confirmed';

        v_iou_remaining := v_iou.amount - v_settlements_sum;
        v_accumulated_owed := v_accumulated_owed + GREATEST(v_iou_remaining, 0);

        IF v_iou_remaining > 0 AND v_remaining_amount > 0 THEN
            IF v_remaining_amount >= v_iou_remaining THEN
                v_allocate := v_iou_remaining;
            ELSE
                v_allocate := v_remaining_amount;
            END IF;

            INSERT INTO public.shared_iou_settlements (
                id, shared_iou_id, amount, proposed_by, status, created_at, confirmed_at, confirmed_by
            ) VALUES (
                'stl_' || replace(gen_random_uuid()::text, '-', ''),
                v_iou.id,
                v_allocate,
                v_payment.payer_id,
                'confirmed',
                v_now,
                v_now,
                v_payee_id
            );

            IF v_allocate = v_iou_remaining THEN
                UPDATE public.shared_ious
                SET status = 'settled', updated_at = v_now
                WHERE id = v_iou.id;
            END IF;

            v_remaining_amount := v_remaining_amount - v_allocate;
        END IF;
    END LOOP;

    -- Strict overpayment check POST-LOCK
    IF v_payment.amount > v_accumulated_owed THEN
        RAISE EXCEPTION 'Overpayment: payment amount (%) exceeds total owed (%) in currency %', v_payment.amount, v_accumulated_owed, v_payment.currency;
    END IF;

    UPDATE public.shared_payments
    SET status = 'accepted', updated_at = v_now, accepted_at = v_now
    WHERE id = p_payment_id
    RETURNING * INTO v_payment;

    INSERT INTO public.notifications (
        id, user_id, actor_id, type, target_id, status, created_at
    ) VALUES (
        'notif_' || replace(gen_random_uuid()::text, '-', ''),
        v_payment.payer_id,
        v_payee_id,
        'shared_payment_accepted',
        v_payment.id,
        'unread',
        v_now
    );

    RETURN v_payment;
END;
$$;


-- 6. Bulk Propose Shared IOUs (Outbox RPC)
CREATE OR REPLACE FUNCTION public.propose_shared_ious_bulk(
    p_idempotency_key text,
    p_transaction_id text,
    p_splits jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_creator_id uuid;
    split JSONB;
    v_now bigint;
    v_idempotency_check uuid;
    v_split_amount numeric;
    v_debtor_id uuid;
    v_payload_hash text;
    v_existing_hash text;
    v_id text;
BEGIN
    v_creator_id := auth.uid();
    IF v_creator_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key required';
    END IF;

    IF p_transaction_id IS NULL OR trim(p_transaction_id) = '' THEN
        RAISE EXCEPTION 'Transaction ID required';
    END IF;

    IF p_splits IS NULL OR jsonb_typeof(p_splits) != 'array' OR jsonb_array_length(p_splits) = 0 THEN
        RAISE EXCEPTION 'Splits array must be a valid non-empty JSON array';
    END IF;

    v_now := (extract(epoch from now()) * 1000)::bigint;
    
    -- Hash transaction_id + normalized JSON payload
    -- jsonb casts strip superficial whitespace and normalize key order deterministically
    v_payload_hash := md5(p_transaction_id || '_' || p_splits::text);

    INSERT INTO public.operation_idempotency (user_id, idempotency_key, operation_type, payload_hash, created_at)
    VALUES (v_creator_id, p_idempotency_key, 'propose_bulk_split', v_payload_hash, v_now)
    ON CONFLICT (user_id, idempotency_key) DO NOTHING
    RETURNING user_id INTO v_idempotency_check;

    IF v_idempotency_check IS NULL THEN
        SELECT payload_hash INTO v_existing_hash FROM public.operation_idempotency 
        WHERE user_id = v_creator_id AND idempotency_key = p_idempotency_key;
        
        IF v_existing_hash != v_payload_hash THEN
            RAISE EXCEPTION 'Idempotency conflict: same key used with different payload';
        END IF;
        
        RETURN; -- Harmless retry
    END IF;

    FOR split IN SELECT * FROM jsonb_array_elements(p_splits)
    LOOP
        v_id := split->>'id';
        v_debtor_id := (split->>'debtor_id')::uuid;
        v_split_amount := (split->>'amount')::numeric;

        IF v_id IS NULL OR trim(v_id) = '' THEN
            RAISE EXCEPTION 'Split ID required';
        END IF;

        IF v_debtor_id IS NULL THEN
            RAISE EXCEPTION 'Invalid debtor ID';
        END IF;

        IF v_debtor_id = v_creator_id THEN
            RAISE EXCEPTION 'Creator cannot be debtor in shared split';
        END IF;

        IF v_split_amount IS NULL OR v_split_amount <= 0 THEN
            RAISE EXCEPTION 'Split amount must be greater than zero';
        END IF;

        -- Validate connection exists and is accepted
        IF NOT EXISTS (
            SELECT 1 FROM public.connections c
            WHERE c.status = 'accepted'
              AND ((c.user_a = v_creator_id AND c.user_b = v_debtor_id)
                OR (c.user_b = v_creator_id AND c.user_a = v_debtor_id))
        ) THEN
            RAISE EXCEPTION 'No active connection with %', v_debtor_id;
        END IF;

        -- DO NOT USE ON CONFLICT DO NOTHING. A collision means client reused UUIDs badly.
        INSERT INTO public.shared_ious (
            id, creator_id, creditor_id, debtor_id, amount, currency, description, status, transaction_id, created_at, updated_at
        ) VALUES (
            v_id,
            v_creator_id,
            v_creator_id,
            v_debtor_id,
            v_split_amount,
            'LKR',
            split->>'description',
            'pending',
            p_transaction_id,
            v_now,
            v_now
        );
    END LOOP;
END;
$$;


-- 7. Cancel Shared IOUs Bulk (Pre-consensus)
CREATE OR REPLACE FUNCTION public.cancel_shared_iou_bulk(
    p_transaction_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_creator_id uuid;
    v_has_accepted boolean;
BEGIN
    v_creator_id := auth.uid();
    IF v_creator_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_transaction_id IS NULL OR trim(p_transaction_id) = '' THEN
        RAISE EXCEPTION 'Transaction ID required';
    END IF;

    -- Lock the relevant IOUs FIRST before checking status to prevent concurrent accept races
    PERFORM id FROM public.shared_ious
    WHERE transaction_id = p_transaction_id
      AND creator_id = v_creator_id
    FOR UPDATE;

    -- Check if ANY connected shared_iou is already accepted/settled
    SELECT EXISTS (
        SELECT 1 FROM public.shared_ious
        WHERE transaction_id = p_transaction_id
          AND creator_id = v_creator_id
          AND status IN ('accepted', 'settled')
    ) INTO v_has_accepted;

    IF v_has_accepted THEN
        RAISE EXCEPTION 'Cannot cancel because some IOUs are already accepted or settled';
    END IF;

    -- Safe to delete pending ones
    DELETE FROM public.shared_ious
    WHERE transaction_id = p_transaction_id
      AND creator_id = v_creator_id
      AND status = 'pending';
END;
$$;

-- Grant EXECUTE privileges to authenticated users
GRANT EXECUTE ON FUNCTION public.propose_shared_payment(text, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_shared_payment(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_shared_ious_bulk(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shared_iou_bulk(text) TO authenticated;

-- Revoke from public/anon
REVOKE EXECUTE ON FUNCTION public.propose_shared_payment(text, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_shared_payment(text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.propose_shared_ious_bulk(text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_shared_iou_bulk(text) FROM PUBLIC, anon;
