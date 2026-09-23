-- Profile Hardening Migration
-- Revoke direct UPDATE access to profiles. Usernames and display names
-- are immutable in V1 and should not be modified bypassing the UI.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
