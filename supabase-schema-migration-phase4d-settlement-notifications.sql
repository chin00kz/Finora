-- Phase 4D: Settlement Notifications

-- 1. PROPOSE PAYMENT
CREATE OR REPLACE FUNCTION propose_iou_payment(
  p_iou_id TEXT,
  p_amount NUMERIC
) RETURNS public.shared_iou_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_parent_iou public.shared_ious;
  v_confirmed_total NUMERIC;
  v_pending_total NUMERIC;
  v_available_to_propose NUMERIC;
  v_settlement_id TEXT;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_iou_settlements;
  v_actor_display_name TEXT;
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

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  PERFORM internal_create_notification(
      v_parent_iou.creditor_id,
      v_uid,
      'shared_iou_payment_proposed',
      v_actor_display_name || ' says they paid you',
      'They marked ' || v_parent_iou.currency || ' ' || p_amount::text || ' as paid.',
      'shared_iou',
      p_iou_id,
      '/debts',
      'shared_iou_payment_proposed:' || v_settlement_id
  );

  RETURN v_result;
END;
$$;

-- 2. CONFIRM PAYMENT
CREATE OR REPLACE FUNCTION confirm_iou_payment(
  p_settlement_id TEXT
) RETURNS public.shared_iou_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_settlement public.shared_iou_settlements;
  v_parent_iou public.shared_ious;
  v_confirmed_total NUMERIC;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_iou_settlements;
  v_actor_display_name TEXT;
  v_body TEXT;
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

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  v_body := 'Your ' || v_parent_iou.currency || ' ' || v_settlement.amount::text || ' payment was confirmed.';

  -- Transition parent if fully settled
  IF v_confirmed_total + v_settlement.amount = v_parent_iou.amount THEN
    UPDATE public.shared_ious SET status = 'settled', updated_at = v_now WHERE id = v_parent_iou.id;
    v_body := v_body || ' This IOU is now settled.';
  END IF;

  PERFORM internal_create_notification(
      v_parent_iou.debtor_id,
      v_uid,
      'shared_iou_payment_confirmed',
      v_actor_display_name || ' confirmed your payment',
      v_body,
      'shared_iou',
      v_parent_iou.id,
      '/debts',
      'shared_iou_payment_confirmed:' || p_settlement_id
  );

  RETURN v_result;
END;
$$;

-- 3. REJECT PAYMENT
CREATE OR REPLACE FUNCTION reject_iou_payment(
  p_settlement_id TEXT
) RETURNS public.shared_iou_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_settlement public.shared_iou_settlements;
  v_parent_iou public.shared_ious;
  v_result public.shared_iou_settlements;
  v_actor_display_name TEXT;
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

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  PERFORM internal_create_notification(
      v_parent_iou.debtor_id,
      v_uid,
      'shared_iou_payment_rejected',
      v_actor_display_name || ' rejected your payment',
      'They rejected the payment of ' || v_parent_iou.currency || ' ' || v_settlement.amount::text || '.',
      'shared_iou',
      v_parent_iou.id,
      '/debts',
      'shared_iou_payment_rejected:' || p_settlement_id
  );

  RETURN v_result;
END;
$$;
