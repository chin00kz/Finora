-- Identity Migration (Phase 1 Follow-up)

-- Remove direct client INSERT policy on profiles
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- Create authoritative RPC for profile creation
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

-- Security Hardening: Remove default PUBLIC execution and restrict to authenticated users
REVOKE EXECUTE ON FUNCTION create_profile(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_profile(TEXT, TEXT) TO authenticated;
