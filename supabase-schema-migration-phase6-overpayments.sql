-- ==============================================================================
-- PHASE 6: SHARED IOU OVERPAYMENTS
-- ==============================================================================

-- 1. Add note column to settlements
ALTER TABLE public.shared_iou_settlements ADD COLUMN IF NOT EXISTS note TEXT CHECK (note IS NULL OR char_length(note) <= 255);

-- 2. Drop the old propose_iou_payment signature (to support adding p_note)
DROP FUNCTION IF EXISTS propose_iou_payment(TEXT, NUMERIC);

-- 3. Replace propose_iou_payment to accept p_note and allow overpayments
CREATE OR REPLACE FUNCTION propose_iou_payment(
  p_iou_id TEXT,
  p_amount NUMERIC,
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
  v_actor_display_name TEXT;
  v_clean_note TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  -- Trim and limit note
  IF p_note IS NOT NULL AND trim(p_note) != '' THEN
    v_clean_note := left(trim(p_note), 255);
  ELSE
    v_clean_note := NULL;
  END IF;

  -- Lock parent IOU to prevent concurrent state changes
  SELECT * INTO v_parent_iou FROM public.shared_ious WHERE id = p_iou_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;
  IF v_parent_iou.status != 'accepted' THEN RAISE EXCEPTION 'invalid_iou_status'; END IF;
  IF v_uid != v_parent_iou.debtor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- (We no longer restrict p_amount > v_available_to_propose)

  v_settlement_id := 'stl_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.shared_iou_settlements (
    id, shared_iou_id, amount, proposed_by, status, created_at, note
  ) VALUES (
    v_settlement_id, p_iou_id, p_amount, v_uid, 'pending', v_now, v_clean_note
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
$func$;

-- 4. Replace confirm_iou_payment to handle overpayment clamping and reverse IOU creation
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
  v_remaining_balance NUMERIC;
  v_excess NUMERIC;
  v_new_iou_id TEXT;
  v_note_desc TEXT;
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

  v_remaining_balance := v_parent_iou.amount - v_confirmed_total;

  IF v_settlement.amount > v_remaining_balance THEN
    IF v_remaining_balance < 0 THEN
      v_excess := v_settlement.amount;
    ELSE
      v_excess := v_settlement.amount - v_remaining_balance;
    END IF;
    
    v_new_iou_id := 'iou_' || replace(gen_random_uuid()::text, '-', '');
    
    -- Format provenance note
    IF v_settlement.note IS NOT NULL AND trim(v_settlement.note) != '' THEN
      v_note_desc := '[Overpayment] ' || trim(v_settlement.note);
    ELSE
      v_note_desc := '[Overpayment]';
    END IF;
    v_note_desc := left(v_note_desc, 255);

    -- Create Reverse IOU
    INSERT INTO public.shared_ious (
      id, creator_id, creditor_id, debtor_id, amount, currency, description, status, created_at, accepted_at, updated_at
    ) VALUES (
      v_new_iou_id,
      v_parent_iou.debtor_id, -- Creator must match creditor to satisfy constraint
      v_parent_iou.debtor_id, -- Original debtor becomes new creditor
      v_parent_iou.creditor_id, -- Original creditor becomes new debtor
      v_excess,
      v_parent_iou.currency,
      v_note_desc,
      'accepted',
      v_now,
      v_now,
      v_now
    );

    -- Parent IOU gets settled
    UPDATE public.shared_ious SET status = 'settled', updated_at = v_now WHERE id = v_parent_iou.id;
  ELSIF v_settlement.amount = v_remaining_balance THEN
    UPDATE public.shared_ious SET status = 'settled', updated_at = v_now WHERE id = v_parent_iou.id;
  END IF;

  -- Confirm the settlement
  UPDATE public.shared_iou_settlements
  SET status = 'confirmed', confirmed_at = v_now, confirmed_by = v_uid
  WHERE id = p_settlement_id
  RETURNING * INTO v_result;

  -- Reject sibling pending proposals if parent is now settled
  IF v_settlement.amount >= v_remaining_balance THEN
    UPDATE public.shared_iou_settlements 
    SET status = 'rejected' 
    WHERE shared_iou_id = v_parent_iou.id 
      AND status = 'pending' 
      AND id != p_settlement_id;
  END IF;

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  v_body := 'Your ' || v_parent_iou.currency || ' ' || v_settlement.amount::text || ' payment was confirmed.';
  
  IF v_settlement.amount >= v_remaining_balance THEN
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
$func$;

-- Re-grant privileges (important after DROP)
REVOKE EXECUTE ON FUNCTION propose_iou_payment(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION propose_iou_payment(TEXT, NUMERIC, TEXT) TO authenticated;
