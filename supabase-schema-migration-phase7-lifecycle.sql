-- Phase 7: Shared IOU Lifecycle (Cancel & Mark as Paid)

-- 1. Update cancel_shared_iou to support accepted IOUs and reject pending settlements
CREATE OR REPLACE FUNCTION cancel_shared_iou(p_iou_id TEXT)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_target_user UUID;
  v_actor_display_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;

  UPDATE public.shared_ious
  SET status = 'cancelled', updated_at = v_now
  WHERE id = p_iou_id
    AND status IN ('pending', 'accepted')
    AND creator_id = v_uid
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_state_transition';
  END IF;

  -- Reject any attached pending settlements atomically
  UPDATE public.shared_iou_settlements
  SET status = 'rejected'
  WHERE shared_iou_id = p_iou_id AND status = 'pending';

  -- Notify the other participant
  IF v_result.creator_id = v_result.creditor_id THEN
    v_target_user := v_result.debtor_id;
  ELSE
    v_target_user := v_result.creditor_id;
  END IF;

  PERFORM internal_create_notification(
    v_target_user,
    v_uid,
    'shared_iou_cancelled',
    v_actor_display_name || ' cancelled an IOU',
    'An IOU for ' || v_result.currency || ' ' || v_result.amount::text || ' was cancelled.',
    'shared_iou',
    v_result.id,
    '/debts',
    'shared_iou_cancelled:' || v_result.id
  );

  RETURN v_result;
END;
$func$;

-- 2. Create mark_iou_paid function
CREATE OR REPLACE FUNCTION mark_iou_paid(
  p_iou_id TEXT,
  p_note TEXT DEFAULT NULL
) RETURNS public.shared_iou_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_parent_iou public.shared_ious;
  v_settlement_id TEXT;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_iou_settlements;
  v_clean_note TEXT;
  v_confirmed_total NUMERIC;
  v_remaining_balance NUMERIC;
  v_actor_display_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;

  IF p_note IS NOT NULL AND trim(p_note) != '' THEN
    v_clean_note := left(trim(p_note), 255);
  ELSE
    v_clean_note := NULL;
  END IF;

  -- Lock parent IOU to prevent concurrent state changes
  SELECT * INTO v_parent_iou FROM public.shared_ious WHERE id = p_iou_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;
  IF v_parent_iou.status != 'accepted' THEN RAISE EXCEPTION 'invalid_iou_status'; END IF;
  IF v_uid != v_parent_iou.creditor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Calculate authoritative remaining balance
  SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_total 
  FROM public.shared_iou_settlements 
  WHERE shared_iou_id = v_parent_iou.id AND status = 'confirmed';
  
  v_remaining_balance := v_parent_iou.amount - v_confirmed_total;

  IF v_remaining_balance <= 0 THEN
    RAISE EXCEPTION 'iou_already_settled';
  END IF;

  v_settlement_id := 'stl_' || replace(gen_random_uuid()::text, '-', '');

  -- Create single confirmed settlement for exact remaining amount
  INSERT INTO public.shared_iou_settlements (
    id, shared_iou_id, amount, proposed_by, status, created_at, confirmed_at, confirmed_by, note
  ) VALUES (
    v_settlement_id, p_iou_id, v_remaining_balance, v_uid, 'confirmed', v_now, v_now, v_uid, v_clean_note
  ) RETURNING * INTO v_result;

  -- Authoritatively settle the IOU
  UPDATE public.shared_ious 
  SET status = 'settled', updated_at = v_now 
  WHERE id = v_parent_iou.id;

  -- Reject any sibling pending settlements
  UPDATE public.shared_iou_settlements 
  SET status = 'rejected' 
  WHERE shared_iou_id = v_parent_iou.id AND status = 'pending' AND id != v_settlement_id;

  -- Notify the debtor
  PERFORM internal_create_notification(
    v_parent_iou.debtor_id,
    v_uid,
    'shared_iou_payment_confirmed',
    v_actor_display_name || ' marked an IOU as paid',
    'They recorded ' || v_parent_iou.currency || ' ' || v_remaining_balance::text || ' as received.',
    'shared_iou',
    v_parent_iou.id,
    '/debts',
    'shared_iou_payment_confirmed:' || v_settlement_id
  );

  RETURN v_result;
END;
$func$;

-- 3. Grants
REVOKE EXECUTE ON FUNCTION mark_iou_paid(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_iou_paid(TEXT, TEXT) TO authenticated;
