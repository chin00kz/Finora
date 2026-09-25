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
    id text NOT NULL PRIMARY KEY,
    idempotency_key text NOT NULL UNIQUE,
    payer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    payee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount numeric NOT NULL CHECK (amount > 0),
    currency text NOT NULL DEFAULT 'LKR',
    notes text,
    status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    accepted_at bigint,
    rejected_at bigint
);

-- RLS for shared_payments
ALTER TABLE public.shared_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their shared_payments"
    ON public.shared_payments FOR SELECT
    USING (auth.uid() = payer_id OR auth.uid() = payee_id);

-- Only RPCs can insert/update, explicitly revoke public access
REVOKE ALL ON public.shared_payments FROM PUBLIC;
REVOKE ALL ON public.shared_payments FROM anon;
REVOKE ALL ON public.shared_payments FROM authenticated;
GRANT SELECT ON public.shared_payments TO authenticated;


-- 1b. Add transaction_id to shared_ious
ALTER TABLE public.shared_ious ADD COLUMN IF NOT EXISTS transaction_id TEXT;


-- 1c. Add Notifications
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'shared_payment_received';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'shared_payment_accepted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'shared_payment_rejected';


-- 2. Propose Shared Payment RPC
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
    v_payment public.shared_payments;
    v_now bigint;
BEGIN
    v_payer_id := auth.uid();
    IF v_payer_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Validate connection exists and is accepted
    IF NOT EXISTS (
        SELECT 1 FROM public.connections c
        WHERE c.status = 'accepted'
          AND ((c.user_a = v_payer_id AND c.user_b = p_payee_id)
            OR (c.user_b = v_payer_id AND c.user_a = p_payee_id))
    ) THEN
        RAISE EXCEPTION 'No active connection with payee';
    END IF;

    v_now := (extract(epoch from now()) * 1000)::bigint;

    INSERT INTO public.shared_payments (
        id, idempotency_key, payer_id, payee_id, amount, currency, notes, status, created_at, updated_at
    ) VALUES (
        'pay_' || replace(gen_random_uuid()::text, '-', ''),
        p_idempotency_key,
        v_payer_id,
        p_payee_id,
        p_amount,
        p_currency,
        p_notes,
        'pending',
        v_now,
        v_now
    ) RETURNING * INTO v_payment;

    -- Emits Notification
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


-- 3. Respond Shared Payment RPC
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
    v_active_ious_total numeric;
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

        -- Notify payer
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

    -- Accepting payment: Allocate against active IOUs
    -- Calculate total owed
    SELECT COALESCE(SUM(amount), 0) INTO v_active_ious_total
    FROM public.shared_ious
    WHERE status = 'accepted'
      AND creditor_id = v_payee_id
      AND debtor_id = v_payment.payer_id;

    -- Calculate total already settled for these IOUs
    SELECT COALESCE(SUM(s.amount), 0) INTO v_settlements_sum
    FROM public.shared_iou_settlements s
    JOIN public.shared_ious i ON s.shared_iou_id = i.id
    WHERE i.status = 'accepted'
      AND i.creditor_id = v_payee_id
      AND i.debtor_id = v_payment.payer_id
      AND s.status = 'confirmed';

    IF v_payment.amount > (v_active_ious_total - v_settlements_sum) THEN
        RAISE EXCEPTION 'Overpayment: payment amount exceeds total owed';
    END IF;

    v_remaining_amount := v_payment.amount;

    FOR v_iou IN 
        SELECT * FROM public.shared_ious 
        WHERE status = 'accepted'
          AND creditor_id = v_payee_id
          AND debtor_id = v_payment.payer_id
        ORDER BY created_at ASC
        FOR UPDATE
    LOOP
        IF v_remaining_amount <= 0 THEN
            EXIT;
        END IF;

        -- Calculate remaining on this specific IOU
        SELECT COALESCE(SUM(amount), 0) INTO v_settlements_sum
        FROM public.shared_iou_settlements
        WHERE shared_iou_id = v_iou.id AND status = 'confirmed';

        v_iou_remaining := v_iou.amount - v_settlements_sum;

        IF v_iou_remaining > 0 THEN
            IF v_remaining_amount >= v_iou_remaining THEN
                v_allocate := v_iou_remaining;
            ELSE
                v_allocate := v_remaining_amount;
            END IF;

            -- Create settlement
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

    -- Update payment
    UPDATE public.shared_payments
    SET status = 'accepted', updated_at = v_now, accepted_at = v_now
    WHERE id = p_payment_id
    RETURNING * INTO v_payment;

    -- Notify payer
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


-- 4. Bulk Propose Shared IOUs (Outbox RPC)
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
BEGIN
    v_creator_id := auth.uid();
    IF v_creator_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_now := (extract(epoch from now()) * 1000)::bigint;

    FOR split IN SELECT * FROM jsonb_array_elements(p_splits)
    LOOP
        -- Validate connection exists and is accepted
        IF NOT EXISTS (
            SELECT 1 FROM public.connections c
            WHERE c.status = 'accepted'
              AND ((c.user_a = v_creator_id AND c.user_b = (split->>'debtor_id')::uuid)
                OR (c.user_b = v_creator_id AND c.user_a = (split->>'debtor_id')::uuid))
        ) THEN
            RAISE EXCEPTION 'No active connection with %', split->>'debtor_id';
        END IF;

        -- Insert idempotent
        INSERT INTO public.shared_ious (
            id, creator_id, creditor_id, debtor_id, amount, currency, description, status, transaction_id, created_at, updated_at
        ) VALUES (
            split->>'id',
            v_creator_id,
            v_creator_id,
            (split->>'debtor_id')::uuid,
            (split->>'amount')::numeric,
            'LKR',
            split->>'description',
            'pending',
            p_transaction_id,
            v_now,
            v_now
        ) ON CONFLICT (id) DO NOTHING;
    END LOOP;
END;
$$;


-- 5. Cancel Shared IOUs Bulk (Pre-consensus)
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

    -- Delete pending ones
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

REVOKE EXECUTE ON FUNCTION public.propose_shared_payment(text, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_shared_payment(text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.propose_shared_ious_bulk(text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_shared_iou_bulk(text) FROM PUBLIC, anon;
