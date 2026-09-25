-- Phase 4C: Shared IOU Notifications

-- 1. CREATE
CREATE OR REPLACE FUNCTION create_shared_iou(
  p_debtor_id UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_description TEXT DEFAULT NULL
) RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conn_status TEXT;
  v_norm_currency TEXT := upper(trim(p_currency));
  v_norm_desc TEXT := NULLIF(trim(p_description), '');
  v_iou_id TEXT;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_actor_display_name TEXT;
  v_body TEXT;
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

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  v_body := 'They say you owe ' || v_norm_currency || ' ' || p_amount::text;
  IF v_norm_desc IS NOT NULL THEN
    v_body := v_body || ' for ' || v_norm_desc;
  END IF;

  PERFORM internal_create_notification(
      p_debtor_id,
      v_uid,
      'shared_iou_request',
      v_actor_display_name || ' sent you an IOU request',
      v_body,
      'shared_iou',
      v_iou_id,
      '/debts',
      'shared_iou_request:' || v_iou_id || ':' || v_now::text
  );

  RETURN v_result;
END;
$$;

-- 2. ACCEPT
CREATE OR REPLACE FUNCTION accept_shared_iou(p_iou_id TEXT)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_actor_display_name TEXT;
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

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  PERFORM internal_create_notification(
      v_result.creator_id,
      v_uid,
      'shared_iou_accepted',
      v_actor_display_name || ' accepted your IOU request',
      'They confirmed they owe ' || v_result.currency || ' ' || v_result.amount::text,
      'shared_iou',
      p_iou_id,
      '/debts',
      'shared_iou_accepted:' || p_iou_id || ':' || v_now::text
  );

  RETURN v_result;
END;
$$;

-- 3. DECLINE
CREATE OR REPLACE FUNCTION decline_shared_iou(p_iou_id TEXT)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_actor_display_name TEXT;
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

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  PERFORM internal_create_notification(
      v_result.creator_id,
      v_uid,
      'shared_iou_declined',
      v_actor_display_name || ' declined your IOU request',
      'They declined the request for ' || v_result.currency || ' ' || v_result.amount::text,
      'shared_iou',
      p_iou_id,
      '/debts',
      'shared_iou_declined:' || p_iou_id || ':' || v_now::text
  );

  RETURN v_result;
END;
$$;

-- 4. CANCEL
CREATE OR REPLACE FUNCTION cancel_shared_iou(p_iou_id TEXT)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_actor_display_name TEXT;
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

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  PERFORM internal_create_notification(
      v_result.debtor_id,
      v_uid,
      'shared_iou_cancelled',
      v_actor_display_name || ' cancelled an IOU request',
      'The request for ' || v_result.currency || ' ' || v_result.amount::text || ' was cancelled.',
      'shared_iou',
      p_iou_id,
      '/debts',
      'shared_iou_cancelled:' || p_iou_id || ':' || v_now::text
  );

  RETURN v_result;
END;
$$;
