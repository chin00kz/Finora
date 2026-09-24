-- Phase 4A: Notifications Foundation

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    route TEXT,
    event_key TEXT UNIQUE NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE notifications
    SET read_at = now()
    WHERE id = p_notification_id
      AND user_id = auth.uid()
      AND read_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE notifications
    SET read_at = now()
    WHERE user_id = auth.uid()
      AND read_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION get_my_notifications(p_limit INT DEFAULT 100)
RETURNS SETOF notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM notifications
    WHERE user_id = auth.uid()
    ORDER BY created_at DESC
    LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_notification_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_notification_read(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_all_notifications_read() TO authenticated;

REVOKE EXECUTE ON FUNCTION get_my_notifications(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_notifications(INT) TO authenticated;

CREATE OR REPLACE FUNCTION internal_create_notification(
    p_user_id UUID,
    p_actor_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_body TEXT,
    p_entity_type TEXT,
    p_entity_id TEXT,
    p_route TEXT,
    p_event_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_notification_id UUID;
BEGIN
    INSERT INTO notifications (
        user_id,
        actor_id,
        type,
        title,
        body,
        entity_type,
        entity_id,
        route,
        event_key
    ) VALUES (
        p_user_id,
        p_actor_id,
        p_type,
        p_title,
        p_body,
        p_entity_type,
        p_entity_id,
        p_route,
        p_event_key
    )
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id INTO v_notification_id;

    IF v_notification_id IS NULL THEN
        SELECT id INTO v_notification_id FROM notifications WHERE event_key = p_event_key;
    END IF;

    RETURN v_notification_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION internal_create_notification(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
