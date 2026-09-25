-- Phase 1: Shared IOUs Identity & Connections

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL CHECK (char_length(username) >= 3 AND char_length(username) <= 24 AND username ~ '^[a-z0-9_]+$'),
  display_name TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
-- INSERT policy intentionally omitted; use create_profile() RPC

CREATE TABLE IF NOT EXISTS public.connections (
  id TEXT PRIMARY KEY,
  user_a UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  action_user_id UUID REFERENCES public.profiles(id),
  blocked_by_user_id UUID REFERENCES public.profiles(id),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT user_order CHECK (user_a < user_b),
  CONSTRAINT unique_connection UNIQUE (user_a, user_b)
);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can see their own connections" ON public.connections;
CREATE POLICY "Users can see their own connections" ON public.connections FOR SELECT USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE OR REPLACE FUNCTION create_profile(p_username TEXT, p_display_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_username TEXT := lower(trim(p_username));
  v_display_name TEXT := trim(p_display_name);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF v_display_name IS NULL OR length(v_display_name) = 0 OR length(v_display_name) > 50 THEN
    RAISE EXCEPTION 'display_name_invalid';
  END IF;

  IF v_username IS NULL OR length(v_username) < 3 OR length(v_username) > 24 THEN
    RAISE EXCEPTION 'username_invalid_length';
  END IF;

  IF v_username !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'username_invalid_format';
  END IF;

  IF v_username = ANY (ARRAY['finora', 'admin', 'administrator', 'support', 'help', 'system', 'root', 'official', 'security', 'moderator', 'mod', 'staff', 'api', 'www']) THEN
    RAISE EXCEPTION 'username_reserved';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'profile_exists';
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, username, display_name, created_at)
    VALUES (v_uid, v_username, v_display_name, (extract(epoch from now()) * 1000)::bigint);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'username_taken';
  END;
END;
$func$;

CREATE OR REPLACE FUNCTION get_profile_by_username(search_username TEXT)
RETURNS TABLE (id UUID, username TEXT, display_name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, username, display_name
  FROM public.profiles
  WHERE username = lower(search_username)
    AND auth.uid() IS NOT NULL
    AND id != auth.uid();
$$;

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

CREATE OR REPLACE FUNCTION get_my_connections()
RETURNS TABLE (
  connection_id TEXT,
  status TEXT,
  action_user_id UUID,
  other_user_id UUID,
  other_username TEXT,
  other_display_name TEXT
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
    p.display_name as other_display_name
  FROM public.connections c
  JOIN public.profiles p ON p.id = (CASE WHEN c.user_a = auth.uid() THEN c.user_b ELSE c.user_a END)
  WHERE c.user_a = auth.uid() OR c.user_b = auth.uid();
$$;

-- Security Hardening: Remove default PUBLIC execution and restrict to authenticated users
REVOKE EXECUTE ON FUNCTION get_profile_by_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_profile_by_username(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION send_connection_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_connection_request(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION respond_connection_request(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION respond_connection_request(TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_my_connections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_connections() TO authenticated;

REVOKE EXECUTE ON FUNCTION create_profile(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_profile(TEXT, TEXT) TO authenticated;

