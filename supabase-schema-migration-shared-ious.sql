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
