-- ==============================================================================
-- PHASE 8: TRUSTED FRIEND IOU AUTO-ACCEPT & REJECTION
-- ==============================================================================

-- 1. Extend connections table with directional auto-accept preferences
ALTER TABLE public.connections 
  ADD COLUMN IF NOT EXISTS user_a_auto_accepts_ious BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_b_auto_accepts_ious BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Extend shared_ious with new 'rejected' status and optional reason
ALTER TABLE public.shared_ious DROP CONSTRAINT IF EXISTS shared_ious_status_check;
ALTER TABLE public.shared_ious ADD CONSTRAINT shared_ious_status_check 
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'settled', 'rejected'));

ALTER TABLE public.shared_ious 
  ADD COLUMN IF NOT EXISTS status_reason TEXT CHECK (status_reason IS NULL OR char_length(status_reason) <= 255);

-- 2b. Update get_my_connections to return auto-accept preferences
DROP FUNCTION IF EXISTS get_my_connections();
CREATE OR REPLACE FUNCTION get_my_connections()
RETURNS TABLE (
  connection_id TEXT,
  status TEXT,
  action_user_id UUID,
  other_user_id UUID,
  other_username TEXT,
  other_display_name TEXT,
  i_auto_accept BOOLEAN,
  they_auto_accept BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id as connection_id,
    c.status,
    c.action_user_id,
    CASE WHEN c.user_a = auth.uid() THEN c.user_b ELSE c.user_a END as other_user_id,
    p.username as other_username,
    p.display_name as other_display_name,
    CASE WHEN c.user_a = auth.uid() THEN c.user_a_auto_accepts_ious ELSE c.user_b_auto_accepts_ious END as i_auto_accept,
    CASE WHEN c.user_a = auth.uid() THEN c.user_b_auto_accepts_ious ELSE c.user_a_auto_accepts_ious END as they_auto_accept
  FROM public.connections c
  JOIN public.profiles p ON p.id = (CASE WHEN c.user_a = auth.uid() THEN c.user_b ELSE c.user_a END)
  WHERE c.user_a = auth.uid() OR c.user_b = auth.uid();
$$;

-- 3. Update create_shared_iou to check auto-accept preference
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
  v_conn public.connections;
  v_norm_currency TEXT := upper(trim(p_currency));
  v_norm_desc TEXT := NULLIF(trim(p_description), '');
  v_iou_id TEXT;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_actor_display_name TEXT;
  v_body TEXT;
  v_auto_accept BOOLEAN := FALSE;
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
  SELECT * INTO v_conn FROM public.connections
  WHERE user_a = least(v_uid, p_debtor_id) AND user_b = greatest(v_uid, p_debtor_id);

  IF v_conn.status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'connection_not_accepted';
  END IF;

  -- Check recipient's auto-accept preference
  IF v_uid = v_conn.user_a THEN
    v_auto_accept := v_conn.user_b_auto_accepts_ious;
  ELSE
    v_auto_accept := v_conn.user_a_auto_accepts_ious;
  END IF;

  v_iou_id := 'iou_' || replace(gen_random_uuid()::text, '-', '');

  IF v_auto_accept THEN
    INSERT INTO public.shared_ious (
      id, creator_id, creditor_id, debtor_id,
      amount, currency, description, status,
      created_at, accepted_at, updated_at
    ) VALUES (
      v_iou_id, v_uid, v_uid, p_debtor_id,
      p_amount, v_norm_currency, v_norm_desc, 'accepted',
      v_now, v_now, v_now
    ) RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.shared_ious (
      id, creator_id, creditor_id, debtor_id,
      amount, currency, description, status,
      created_at, accepted_at, updated_at
    ) VALUES (
      v_iou_id, v_uid, v_uid, p_debtor_id,
      p_amount, v_norm_currency, v_norm_desc, 'pending',
      v_now, NULL, v_now
    ) RETURNING * INTO v_result;
  END IF;

  -- Notifications
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  IF v_auto_accept THEN
    v_body := 'You owe ' || v_norm_currency || ' ' || p_amount::text;
    IF v_norm_desc IS NOT NULL THEN
      v_body := v_body || ' for ' || v_norm_desc;
    END IF;
    v_body := v_body || ' (Automatically accepted)';

    PERFORM internal_create_notification(
        p_debtor_id,
        v_uid,
        'shared_iou_auto_accepted',
        v_actor_display_name || ' added an IOU',
        v_body,
        'shared_iou',
        v_iou_id,
        '/debts',
        'shared_iou_auto_accepted:' || v_iou_id || ':' || v_now::text
    );
  ELSE
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
  END IF;

  RETURN v_result;
END;
$func$;

-- 4. Create reject_shared_iou function for post-accept debtor rejection
CREATE OR REPLACE FUNCTION reject_shared_iou(p_iou_id TEXT, p_reason TEXT DEFAULT NULL)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_confirmed_total NUMERIC;
  v_actor_display_name TEXT;
  v_clean_reason TEXT := NULLIF(trim(p_reason), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  
  IF v_clean_reason IS NOT NULL AND char_length(v_clean_reason) > 255 THEN
    RAISE EXCEPTION 'reason_too_long';
  END IF;

  -- 1. Lock the IOU and verify state
  SELECT * INTO v_result 
  FROM public.shared_ious 
  WHERE id = p_iou_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'iou_not_found';
  END IF;

  IF v_result.debtor_id != v_uid THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF v_result.status != 'accepted' THEN
    RAISE EXCEPTION 'invalid_state_transition';
  END IF;

  -- 2. Verify 0 confirmed settlements
  SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_total
  FROM public.shared_iou_settlements
  WHERE shared_iou_id = p_iou_id AND status = 'confirmed';

  IF v_confirmed_total > 0 THEN
    RAISE EXCEPTION 'cannot_reject_with_payments';
  END IF;

  -- 3. Update IOU
  UPDATE public.shared_ious
  SET status = 'rejected', 
      status_reason = v_clean_reason,
      updated_at = v_now
  WHERE id = p_iou_id
  RETURNING * INTO v_result;

  -- 4. Reject pending settlements
  UPDATE public.shared_iou_settlements
  SET status = 'rejected'
  WHERE shared_iou_id = p_iou_id AND status = 'pending';

  -- 5. Notify creator
  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  PERFORM internal_create_notification(
    v_result.creator_id,
    v_uid,
    'shared_iou_rejected',
    v_actor_display_name || ' rejected an IOU',
    'An IOU for ' || v_result.currency || ' ' || v_result.amount::text || ' was rejected.' || COALESCE(' Reason: ' || v_clean_reason, ''),
    'shared_iou',
    v_result.id,
    '/debts',
    'shared_iou_rejected:' || v_result.id || ':' || v_now::text
  );

  RETURN v_result;
END;
$func$;

-- 5. Create set_connection_auto_accept RPC
CREATE OR REPLACE FUNCTION set_connection_auto_accept(p_connection_id TEXT, p_auto_accept BOOLEAN)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_conn public.connections;
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  
  SELECT * INTO v_conn FROM public.connections WHERE id = p_connection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connection_not_found'; END IF;

  IF v_conn.user_a = v_uid THEN
    UPDATE public.connections SET user_a_auto_accepts_ious = p_auto_accept, updated_at = v_now WHERE id = p_connection_id;
  ELSIF v_conn.user_b = v_uid THEN
    UPDATE public.connections SET user_b_auto_accepts_ious = p_auto_accept, updated_at = v_now WHERE id = p_connection_id;
  ELSE
    RAISE EXCEPTION 'unauthorized';
  END IF;
END;
$func$;

-- 6. RPC Permissions
REVOKE EXECUTE ON FUNCTION create_shared_iou(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_shared_iou(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION reject_shared_iou(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reject_shared_iou(TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION set_connection_auto_accept(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_connection_auto_accept(TEXT, BOOLEAN) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_my_connections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_connections() TO authenticated;
