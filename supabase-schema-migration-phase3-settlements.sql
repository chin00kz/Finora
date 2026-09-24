
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
