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
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

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

  SELECT status INTO v_existing_status FROM public.connections WHERE user_a = v_user_a AND user_b = v_user_b;
  IF FOUND THEN
    IF v_existing_status = 'blocked' THEN RAISE EXCEPTION 'Connection blocked'; END IF;
    IF v_existing_status IN ('pending', 'accepted') THEN RAISE EXCEPTION 'Connection already %', v_existing_status; END IF;
    UPDATE public.connections SET status = 'pending', action_user_id = v_uid, updated_at = (extract(epoch from now()) * 1000)::bigint
    WHERE user_a = v_user_a AND user_b = v_user_b;
    RETURN 're-requested';
  END IF;

  v_connection_id := 'conn_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.connections (id, user_a, user_b, status, action_user_id, created_at, updated_at)
  VALUES (v_connection_id, v_user_a, v_user_b, 'pending', v_uid, (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint);
  
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF response_status NOT IN ('accepted', 'declined') THEN RAISE EXCEPTION 'Invalid response'; END IF;

  SELECT * INTO v_conn FROM public.connections WHERE id = conn_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found'; END IF;
  
  IF v_uid != v_conn.user_a AND v_uid != v_conn.user_b THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_uid = v_conn.action_user_id THEN RAISE EXCEPTION 'Cannot accept your own request'; END IF;
  IF v_conn.status != 'pending' THEN RAISE EXCEPTION 'Connection is not pending'; END IF;

  UPDATE public.connections 
  SET status = response_status, action_user_id = v_uid, updated_at = (extract(epoch from now()) * 1000)::bigint
  WHERE id = conn_id;

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
