-- Phase 4B: Connection Notifications

CREATE OR REPLACE FUNCTION send_connection_request(target_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_a UUID;
  v_user_b UUID;
  v_connection_id TEXT;
  v_existing_status TEXT;
  v_uid UUID := auth.uid();
  v_updated_at BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_actor_display_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_uid = target_user_id THEN RAISE EXCEPTION 'Cannot connect to self'; END IF;

  IF v_uid < target_user_id THEN
    v_user_a := v_uid;
    v_user_b := target_user_id;
  ELSE
    v_user_a := target_user_id;
    v_user_b := v_uid;
  END IF;

  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  SELECT id, status INTO v_connection_id, v_existing_status FROM public.connections WHERE user_a = v_user_a AND user_b = v_user_b;
  IF FOUND THEN
    IF v_existing_status = 'blocked' THEN RAISE EXCEPTION 'Connection blocked'; END IF;
    IF v_existing_status IN ('pending', 'accepted') THEN RAISE EXCEPTION 'Connection already %', v_existing_status; END IF;

    UPDATE public.connections SET status = 'pending', action_user_id = v_uid, updated_at = v_updated_at
    WHERE id = v_connection_id;

    PERFORM internal_create_notification(
        target_user_id,
        v_uid,
        'connection_request',
        v_actor_display_name || ' sent you a friend request',
        'Tap to view and respond in Connections.',
        'connection',
        v_connection_id,
        '/connections',
        'connection_request:' || v_connection_id || ':' || v_updated_at::text
    );

    RETURN 're-requested';
  END IF;

  v_connection_id := 'conn_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.connections (id, user_a, user_b, status, action_user_id, created_at, updated_at)
  VALUES (v_connection_id, v_user_a, v_user_b, 'pending', v_uid, v_updated_at, v_updated_at);

  PERFORM internal_create_notification(
      target_user_id,
      v_uid,
      'connection_request',
      v_actor_display_name || ' sent you a friend request',
      'Tap to view and respond in Connections.',
      'connection',
      v_connection_id,
      '/connections',
      'connection_request:' || v_connection_id || ':' || v_updated_at::text
  );

  RETURN v_connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION respond_connection_request(conn_id TEXT, response_status TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD;
  v_uid UUID := auth.uid();
  v_updated_at BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_actor_display_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF response_status NOT IN ('accepted', 'declined') THEN RAISE EXCEPTION 'Invalid response'; END IF;

  SELECT * INTO v_conn FROM public.connections WHERE id = conn_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found'; END IF;

  IF v_uid != v_conn.user_a AND v_uid != v_conn.user_b THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_uid = v_conn.action_user_id THEN RAISE EXCEPTION 'Cannot accept your own request'; END IF;
  IF v_conn.status != 'pending' THEN RAISE EXCEPTION 'Connection is not pending'; END IF;

  UPDATE public.connections
  SET status = response_status, action_user_id = v_uid, updated_at = v_updated_at
  WHERE id = conn_id;

  IF response_status = 'accepted' THEN
    SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
      SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
      v_actor_display_name := '@' || v_actor_display_name;
    END IF;

    PERFORM internal_create_notification(
        v_conn.action_user_id,
        v_uid,
        'connection_accepted',
        v_actor_display_name || ' accepted your friend request',
        'You are now connected.',
        'connection',
        conn_id,
        '/connections',
        'connection_accepted:' || conn_id || ':' || v_updated_at::text
    );
  END IF;

  RETURN 'success';
END;
$$;
