-- ==============================================================================
-- FINORA — PATCH: Settlement Integrity & D2 Zero-Gap Recovery
--
-- Addresses financial integrity findings from the 2026-09-30 audit:
--
-- R1: confirm_iou_payment + reject_iou_payment concurrent-access race
--     Re-reads the settlement status under the parent IOU lock (with SELECT ... 
--     FOR UPDATE on the settlement itself) so that transitions are atomic.
--     Locking order: 1. parent shared_ious, 2. shared_iou_settlements.
--
-- R2: cancel_shared_iou allowed cancelling accepted IOUs that had confirmed
--     settlements. Adds a confirmed-total check blocking cancellation.
--
-- D2: Zero-Gap Crash Recovery for Deposits
--     Changes mark_iou_paid and propose_iou_payment to accept an optional
--     p_settlement_id from the client. This allows the client to durably
--     record a local deposit intent in Dexie keyed by this ID *before*
--     executing the RPC, guaranteeing recovery if the network or app crashes.
--     Includes backend idempotency logic for exact retries.
--
-- Backward compatibility: Old signatures are dropped and replaced with
-- DEFAULT NULL parameters, maintaining seamless PostgREST resolution.
-- ==============================================================================


-- ==============================================================================
-- FIX D2: mark_iou_paid (Add p_settlement_id & Backend Idempotency)
-- ==============================================================================
DROP FUNCTION IF EXISTS mark_iou_paid(TEXT);
DROP FUNCTION IF EXISTS mark_iou_paid(TEXT, TEXT);

CREATE OR REPLACE FUNCTION mark_iou_paid(
  p_iou_id TEXT,
  p_note TEXT DEFAULT NULL,
  p_settlement_id TEXT DEFAULT NULL
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
  v_confirmed_total NUMERIC;
  v_remaining_balance NUMERIC;
  v_existing_settlement public.shared_iou_settlements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF p_note IS NOT NULL AND trim(p_note) != '' THEN
    v_clean_note := left(trim(p_note), 255);
  ELSE
    v_clean_note := NULL;
  END IF;

  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;

  -- Lock parent IOU to prevent concurrent state changes
  SELECT * INTO v_parent_iou FROM public.shared_ious WHERE id = p_iou_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;

  IF v_uid != v_parent_iou.creditor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Backend Idempotency Check: if client retries a network timeout with the same ID
  IF p_settlement_id IS NOT NULL THEN
    SELECT * INTO v_existing_settlement FROM public.shared_iou_settlements WHERE id = p_settlement_id;
    IF FOUND THEN
      IF v_existing_settlement.shared_iou_id != p_iou_id THEN
        RAISE EXCEPTION 'settlement_id_conflict';
      END IF;
      -- Discriminator: must be a Mark Paid settlement (creditor is both proposer and confirmer)
      IF v_existing_settlement.proposed_by != v_uid OR v_existing_settlement.confirmed_by != v_uid OR v_existing_settlement.status != 'confirmed' THEN
        RAISE EXCEPTION 'settlement_id_conflict';
      END IF;
      -- Safe to return exact match seamlessly
      RETURN v_existing_settlement;
    END IF;
    v_settlement_id := p_settlement_id;
  ELSE
    v_settlement_id := 'stl_' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  -- Only for a NEW operation: require parent status to be accepted
  IF v_parent_iou.status != 'accepted' THEN RAISE EXCEPTION 'invalid_iou_status'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_total 
  FROM public.shared_iou_settlements 
  WHERE shared_iou_id = v_parent_iou.id AND status = 'confirmed';
  
  v_remaining_balance := v_parent_iou.amount - v_confirmed_total;

  IF v_remaining_balance <= 0 THEN
    RAISE EXCEPTION 'iou_already_settled';
  END IF;

  INSERT INTO public.shared_iou_settlements (
    id, shared_iou_id, amount, proposed_by, status, created_at, confirmed_at, confirmed_by, note
  ) VALUES (
    v_settlement_id, p_iou_id, v_remaining_balance, v_uid, 'confirmed', v_now, v_now, v_uid, v_clean_note
  ) RETURNING * INTO v_result;

  UPDATE public.shared_ious 
  SET status = 'settled', updated_at = v_now 
  WHERE id = v_parent_iou.id;

  UPDATE public.shared_iou_settlements 
  SET status = 'rejected' 
  WHERE shared_iou_id = v_parent_iou.id AND status = 'pending' AND id != v_settlement_id;

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


-- ==============================================================================
-- FIX D2: propose_iou_payment (Add p_settlement_id & Backend Idempotency)
-- ==============================================================================
DROP FUNCTION IF EXISTS propose_iou_payment(TEXT, NUMERIC);
DROP FUNCTION IF EXISTS propose_iou_payment(TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION propose_iou_payment(
  p_iou_id TEXT,
  p_amount NUMERIC,
  p_note TEXT DEFAULT NULL,
  p_settlement_id TEXT DEFAULT NULL
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
  v_existing_settlement public.shared_iou_settlements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  IF p_note IS NOT NULL AND trim(p_note) != '' THEN
    v_clean_note := left(trim(p_note), 255);
  ELSE
    v_clean_note := NULL;
  END IF;

  SELECT * INTO v_parent_iou FROM public.shared_ious WHERE id = p_iou_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;

  IF v_uid != v_parent_iou.debtor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Backend Idempotency Check
  IF p_settlement_id IS NOT NULL THEN
    SELECT * INTO v_existing_settlement FROM public.shared_iou_settlements WHERE id = p_settlement_id;
    IF FOUND THEN
      IF v_existing_settlement.shared_iou_id != p_iou_id THEN
        RAISE EXCEPTION 'settlement_id_conflict';
      END IF;
      -- Discriminator: must match the exact same proposal parameters
      IF v_existing_settlement.proposed_by != v_uid OR v_existing_settlement.amount != p_amount THEN
        RAISE EXCEPTION 'settlement_id_conflict';
      END IF;
      -- Safe to return existing proposal
      RETURN v_existing_settlement;
    END IF;
    v_settlement_id := p_settlement_id;
  ELSE
    v_settlement_id := 'stl_' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  -- Only for a NEW operation: require parent status to be accepted
  IF v_parent_iou.status != 'accepted' THEN RAISE EXCEPTION 'invalid_iou_status'; END IF;

  INSERT INTO public.shared_iou_settlements (
    id, shared_iou_id, amount, proposed_by, status, created_at, note
  ) VALUES (
    v_settlement_id, p_iou_id, p_amount, v_uid, 'pending', v_now, v_clean_note
  ) RETURNING * INTO v_result;

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


-- ==============================================================================
-- FIX R1A: Harden confirm_iou_payment
-- ==============================================================================
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
  v_shared_iou_id TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT shared_iou_id INTO v_shared_iou_id
    FROM public.shared_iou_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;

  SELECT * INTO v_parent_iou
    FROM public.shared_ious WHERE id = v_shared_iou_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;

  IF v_uid != v_parent_iou.creditor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_parent_iou.status != 'accepted' THEN RAISE EXCEPTION 'invalid_iou_status'; END IF;

  SELECT * INTO v_settlement
    FROM public.shared_iou_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_settlement.status != 'pending' THEN RAISE EXCEPTION 'settlement_not_pending'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_total
    FROM public.shared_iou_settlements
    WHERE shared_iou_id = v_parent_iou.id AND status = 'confirmed';

  v_remaining_balance := v_parent_iou.amount - v_confirmed_total;

  UPDATE public.shared_iou_settlements
    SET status = 'confirmed', confirmed_at = v_now, confirmed_by = v_uid
    WHERE id = p_settlement_id
    RETURNING * INTO v_result;

  IF v_settlement.amount > v_remaining_balance THEN
    IF v_remaining_balance < 0 THEN
      v_excess := v_settlement.amount;
    ELSE
      v_excess := v_settlement.amount - v_remaining_balance;
    END IF;

    v_new_iou_id := 'iou_' || replace(gen_random_uuid()::text, '-', '');

    IF v_settlement.note IS NOT NULL AND trim(v_settlement.note) != '' THEN
      v_note_desc := '[Overpayment] ' || trim(v_settlement.note);
    ELSE
      v_note_desc := '[Overpayment]';
    END IF;
    v_note_desc := left(v_note_desc, 255);

    INSERT INTO public.shared_ious (
      id, creator_id, creditor_id, debtor_id, amount, currency, description, status, created_at, accepted_at, updated_at
    ) VALUES (
      v_new_iou_id,
      v_parent_iou.debtor_id,
      v_parent_iou.debtor_id,
      v_parent_iou.creditor_id,
      v_excess,
      v_parent_iou.currency,
      v_note_desc,
      'accepted',
      v_now, v_now, v_now
    );

    UPDATE public.shared_ious SET status = 'settled', updated_at = v_now WHERE id = v_parent_iou.id;

  ELSIF v_settlement.amount = v_remaining_balance THEN
    UPDATE public.shared_ious SET status = 'settled', updated_at = v_now WHERE id = v_parent_iou.id;
  END IF;

  IF v_settlement.amount >= v_remaining_balance THEN
    UPDATE public.shared_iou_settlements
      SET status = 'rejected'
      WHERE shared_iou_id = v_parent_iou.id
        AND status = 'pending'
        AND id != p_settlement_id;
  END IF;

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


-- ==============================================================================
-- FIX R1B: Harden reject_iou_payment
-- ==============================================================================
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
  v_actor_display_name TEXT;
  v_shared_iou_id TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT shared_iou_id INTO v_shared_iou_id
    FROM public.shared_iou_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;

  SELECT * INTO v_parent_iou
    FROM public.shared_ious WHERE id = v_shared_iou_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;

  IF v_uid != v_parent_iou.creditor_id THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT * INTO v_settlement
    FROM public.shared_iou_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_settlement.status != 'pending' THEN RAISE EXCEPTION 'settlement_not_pending'; END IF;

  UPDATE public.shared_iou_settlements
    SET status = 'rejected'
    WHERE id = p_settlement_id
    RETURNING * INTO v_result;

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
$func$;


-- ==============================================================================
-- FIX R2: Harden cancel_shared_iou
-- ==============================================================================
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
  v_confirmed_total NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;

  SELECT * INTO v_result
    FROM public.shared_ious WHERE id = p_iou_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;
  IF v_result.creator_id != v_uid THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF v_result.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'invalid_state_transition';
  END IF;

  IF v_result.status = 'accepted' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_total
      FROM public.shared_iou_settlements
      WHERE shared_iou_id = p_iou_id AND status = 'confirmed';

    IF v_confirmed_total > 0 THEN
      RAISE EXCEPTION 'cannot_cancel_with_confirmed_payments';
    END IF;
  END IF;

  UPDATE public.shared_ious
    SET status = 'cancelled', updated_at = v_now
    WHERE id = p_iou_id
    RETURNING * INTO v_result;

  UPDATE public.shared_iou_settlements
    SET status = 'rejected'
    WHERE shared_iou_id = p_iou_id AND status = 'pending';

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


-- ==============================================================================
-- Re-grant privileges
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION mark_iou_paid(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_iou_paid(TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION propose_iou_payment(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION propose_iou_payment(TEXT, NUMERIC, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION confirm_iou_payment(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_iou_payment(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION reject_iou_payment(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reject_iou_payment(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION cancel_shared_iou(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_shared_iou(TEXT) TO authenticated;
