-- Migration: Add connection_id to public.people and enable Realtime for people

-- 1. Add the column safely
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS connection_id TEXT;

-- 2. Safely add public.people to supabase_realtime publication
DO $$
BEGIN
  -- Check if the table is already part of the publication
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'people'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.people;
  END IF;
END $$;
