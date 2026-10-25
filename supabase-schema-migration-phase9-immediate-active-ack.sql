-- ==============================================================================
-- PHASE 9: Shared IOU immediate usability + recipient acknowledgement
-- (Audit fixes A1–A4: safe rerun backfill, reverse-IOU ack, ack notify, preflight)
--
-- Model:
--   status = 'accepted'              → operationally active (settlements allowed)
--   recipient_acknowledged_at IS NULL → debtor has not acknowledged
--   recipient_acknowledged_at set    → debtor acknowledged
--   status = 'rejected'              → terminal (Phase 8: blocked if confirmed payments exist)
--
-- Reverse IOU (overpayment): created when the creditor confirms an overpay.
-- That confirm is treated as the debtor's acknowledgement of the reverse
-- obligation → recipient_acknowledged_at is set at insert (not left NULL).
--
-- Existing pending IOUs are NOT promoted to accepted (handshake preserved).
-- Immediate usability applies to NEW creates via create_shared_iou only.
--
-- Atomicity: entire body runs in one PostgreSQL transaction (BEGIN…COMMIT).
-- Marker is written last so it cannot commit without successful RPC replaces.
-- Run this file as a single script (psql or SQL editor that honors transaction
-- blocks). Do not paste statement-by-statement with autocommit.
--
-- DO NOT apply to live DBs until reviewed. This file is additive SQL only.
-- Does not enable Choice A. Does not alter personal dirty sync.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- A4 — Preflight: fail fast with actionable errors if Phase 8 / integrity missing
-- ------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_status_def TEXT;
  v_propose_args TEXT;
  v_mark_args TEXT;
BEGIN
  IF to_regclass('public.shared_ious') IS NULL THEN
    RAISE EXCEPTION 'phase9_preflight_failed: public.shared_ious missing. Apply shared-ious migrations first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shared_ious' AND column_name = 'status_reason'
  ) THEN
    RAISE EXCEPTION 'phase9_preflight_failed: shared_ious.status_reason missing. Apply supabase-schema-migration-phase8-auto-accept.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'connections' AND column_name = 'user_a_auto_accepts_ious'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'connections' AND column_name = 'user_b_auto_accepts_ious'
  ) THEN
    RAISE EXCEPTION 'phase9_preflight_failed: connections auto-accept columns missing. Apply supabase-schema-migration-phase8-auto-accept.sql first.';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_status_def
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public' AND t.relname = 'shared_ious' AND c.conname = 'shared_ious_status_check';

  IF v_status_def IS NULL OR position('rejected' IN v_status_def) = 0 THEN
    RAISE EXCEPTION 'phase9_preflight_failed: shared_ious_status_check must allow rejected. Apply supabase-schema-migration-phase8-auto-accept.sql first. Found: %', v_status_def;
  END IF;

  IF to_regprocedure('public.internal_create_notification(uuid,uuid,text,text,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'phase9_preflight_failed: internal_create_notification missing. Apply notification migrations (phase4+) first.';
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_propose_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'propose_iou_payment'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_propose_args IS NULL OR position('p_settlement_id' IN v_propose_args) = 0 THEN
    RAISE EXCEPTION 'phase9_preflight_failed: propose_iou_payment must accept p_settlement_id. Apply supabase-schema-migration-patch-settlement-integrity.sql first. Found args: %', v_propose_args;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_mark_args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'mark_iou_paid'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_mark_args IS NULL OR position('p_settlement_id' IN v_mark_args) = 0 THEN
    RAISE EXCEPTION 'phase9_preflight_failed: mark_iou_paid must accept p_settlement_id. Apply supabase-schema-migration-patch-settlement-integrity.sql first. Found args: %', v_mark_args;
  END IF;

  RAISE NOTICE 'phase9_preflight_ok: Phase 8 columns/constraints and settlement-integrity RPC signatures present.';
END;
$preflight$;

-- ------------------------------------------------------------------------------
-- Durable one-time markers (A1)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finora_schema_markers (
  marker TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

REVOKE ALL ON public.finora_schema_markers FROM PUBLIC;
REVOKE ALL ON public.finora_schema_markers FROM anon;
REVOKE ALL ON public.finora_schema_markers FROM authenticated;

-- 1. Acknowledgement column (NULL = awaiting acknowledgement)
ALTER TABLE public.shared_ious
  ADD COLUMN IF NOT EXISTS recipient_acknowledged_at BIGINT;

COMMENT ON COLUMN public.shared_ious.recipient_acknowledged_at IS
  'When the debtor acknowledged the IOU. NULL = awaiting acknowledgement while status may still be accepted (active).';

-- ------------------------------------------------------------------------------
-- A1 — Legacy ack stamp (marker-gated). Marker written AFTER RPCs (end of txn).
-- Does NOT promote pending → accepted (existing handshake rows stay pending).
-- ------------------------------------------------------------------------------
DO $backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.finora_schema_markers
    WHERE marker = 'phase9_legacy_ack_backfill_v1'
  ) THEN
    RAISE NOTICE 'phase9: marker phase9_legacy_ack_backfill_v1 present — skipping legacy ack backfill (safe rerun).';
  ELSE
    -- Legacy accepted/settled were truly acknowledged under the old handshake model.
    UPDATE public.shared_ious
    SET recipient_acknowledged_at = COALESCE(accepted_at, updated_at, created_at)
    WHERE status IN ('accepted', 'settled')
      AND recipient_acknowledged_at IS NULL;

    RAISE NOTICE 'phase9: legacy accepted/settled ack stamp completed (marker deferred until RPCs succeed).';
  END IF;
END;
$backfill$;

-- ------------------------------------------------------------------------------
-- create_shared_iou — always operationally active; ack only on auto-accept
-- ------------------------------------------------------------------------------
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
  v_ack_at BIGINT := NULL;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_debtor_id IS NULL THEN RAISE EXCEPTION 'invalid_debtor'; END IF;
  IF v_uid = p_debtor_id THEN RAISE EXCEPTION 'cannot_create_with_self'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF v_norm_currency !~ '^[A-Z]{3,5}$' THEN RAISE EXCEPTION 'invalid_currency'; END IF;
  IF v_norm_desc IS NOT NULL AND char_length(v_norm_desc) > 255 THEN
    RAISE EXCEPTION 'description_too_long';
  END IF;

  SELECT * INTO v_conn FROM public.connections
  WHERE user_a = least(v_uid, p_debtor_id) AND user_b = greatest(v_uid, p_debtor_id);

  IF v_conn.status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'connection_not_accepted';
  END IF;

  IF v_uid = v_conn.user_a THEN
    v_auto_accept := v_conn.user_b_auto_accepts_ious;
  ELSE
    v_auto_accept := v_conn.user_a_auto_accepts_ious;
  END IF;

  IF v_auto_accept THEN
    v_ack_at := v_now;
  END IF;

  v_iou_id := 'iou_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.shared_ious (
    id, creator_id, creditor_id, debtor_id,
    amount, currency, description, status,
    created_at, accepted_at, updated_at, recipient_acknowledged_at
  ) VALUES (
    v_iou_id, v_uid, v_uid, p_debtor_id,
    p_amount, v_norm_currency, v_norm_desc, 'accepted',
    v_now, v_now, v_now, v_ack_at
  ) RETURNING * INTO v_result;

  SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
  IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
    SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    v_actor_display_name := '@' || v_actor_display_name;
  END IF;

  v_body := 'You owe ' || v_norm_currency || ' ' || p_amount::text;
  IF v_norm_desc IS NOT NULL THEN
    v_body := v_body || ' for ' || v_norm_desc;
  END IF;

  IF v_auto_accept THEN
    v_body := v_body || ' (Automatically acknowledged)';
    PERFORM internal_create_notification(
      p_debtor_id, v_uid, 'shared_iou_auto_accepted',
      v_actor_display_name || ' added an IOU', v_body,
      'shared_iou', v_iou_id, '/debts',
      'shared_iou_auto_accepted:' || v_iou_id || ':' || v_now::text
    );
  ELSE
    v_body := v_body || ' — review or reject if incorrect';
    PERFORM internal_create_notification(
      p_debtor_id, v_uid, 'shared_iou_request',
      v_actor_display_name || ' added an IOU', v_body,
      'shared_iou', v_iou_id, '/debts',
      'shared_iou_request:' || v_iou_id || ':' || v_now::text
    );
  END IF;

  RETURN v_result;
END;
$func$;

-- ------------------------------------------------------------------------------
-- accept_shared_iou — acknowledge + notify creator (A3; idempotent event_key)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_shared_iou(p_iou_id TEXT)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_prior_ack BIGINT;
  v_actor_display_name TEXT;
  v_did_ack BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_result FROM public.shared_ious WHERE id = p_iou_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;
  IF v_result.debtor_id != v_uid THEN RAISE EXCEPTION 'not_authorized'; END IF;

  v_prior_ack := v_result.recipient_acknowledged_at;

  -- Idempotent: already acknowledged
  IF v_result.status = 'accepted' AND v_result.recipient_acknowledged_at IS NOT NULL THEN
    RETURN v_result;
  END IF;

  IF v_result.status = 'pending' THEN
    UPDATE public.shared_ious
    SET status = 'accepted',
        accepted_at = COALESCE(accepted_at, v_now),
        recipient_acknowledged_at = v_now,
        updated_at = v_now
    WHERE id = p_iou_id
    RETURNING * INTO v_result;
    v_did_ack := TRUE;
  ELSIF v_result.status = 'accepted' AND v_result.recipient_acknowledged_at IS NULL THEN
    UPDATE public.shared_ious
    SET recipient_acknowledged_at = v_now,
        updated_at = v_now
    WHERE id = p_iou_id
    RETURNING * INTO v_result;
    v_did_ack := TRUE;
  ELSE
    RAISE EXCEPTION 'invalid_state_transition';
  END IF;

  -- Notify creator only on first successful acknowledgement transition.
  -- Stable event_key (no timestamp) → ON CONFLICT DO NOTHING prevents duplicates on retry.
  IF v_did_ack AND v_prior_ack IS NULL AND v_result.recipient_acknowledged_at IS NOT NULL THEN
    SELECT display_name INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
    IF v_actor_display_name IS NULL OR length(trim(v_actor_display_name)) = 0 THEN
      SELECT username INTO v_actor_display_name FROM public.profiles WHERE id = v_uid;
      v_actor_display_name := '@' || v_actor_display_name;
    END IF;

    PERFORM internal_create_notification(
      v_result.creator_id,
      v_uid,
      'shared_iou_accepted',
      v_actor_display_name || ' acknowledged your IOU',
      'They acknowledged they owe ' || v_result.currency || ' ' || v_result.amount::text,
      'shared_iou',
      p_iou_id,
      '/debts',
      'shared_iou_acknowledged:' || p_iou_id
    );
  END IF;

  RETURN v_result;
END;
$func$;

-- ------------------------------------------------------------------------------
-- reject_shared_iou — unacked/active or leftover pending; Phase 8 payment guard
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_shared_iou(p_iou_id TEXT, p_reason TEXT DEFAULT NULL)
RETURNS public.shared_ious
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid UUID := auth.uid();
  v_now BIGINT := (extract(epoch from now()) * 1000)::bigint;
  v_result public.shared_ious;
  v_actor_display_name TEXT;
  v_clean_reason TEXT := NULLIF(trim(p_reason), '');
  v_confirmed_total NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_clean_reason IS NOT NULL AND char_length(v_clean_reason) > 255 THEN
    RAISE EXCEPTION 'reason_too_long';
  END IF;

  SELECT * INTO v_result FROM public.shared_ious WHERE id = p_iou_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'iou_not_found'; END IF;
  IF v_result.debtor_id != v_uid THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF v_result.status = 'rejected' THEN
    RETURN v_result;
  END IF;

  IF v_result.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'invalid_state_transition';
  END IF;

  -- Phase 8 safeguard: do not mutate status/settlements when confirmed payments exist.
  SELECT COALESCE(SUM(amount), 0) INTO v_confirmed_total
  FROM public.shared_iou_settlements
  WHERE shared_iou_id = p_iou_id AND status = 'confirmed';

  IF v_confirmed_total > 0 THEN
    RAISE EXCEPTION 'cannot_reject_with_payments';
  END IF;

  UPDATE public.shared_ious
  SET status = 'rejected',
      status_reason = v_clean_reason,
      updated_at = v_now
  WHERE id = p_iou_id
  RETURNING * INTO v_result;

  UPDATE public.shared_iou_settlements
  SET status = 'rejected'
  WHERE shared_iou_id = p_iou_id AND status = 'pending';

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
    'An IOU for ' || v_result.currency || ' ' || v_result.amount::text || ' was rejected.'
      || COALESCE(' Reason: ' || v_clean_reason, ''),
    'shared_iou',
    v_result.id,
    '/debts',
    'shared_iou_rejected:' || v_result.id || ':' || v_now::text
  );

  RETURN v_result;
END;
$func$;

-- ------------------------------------------------------------------------------
-- A2 — confirm_iou_payment: reverse IOU sets recipient_acknowledged_at
-- (Based on settlement-integrity patch; adds ack column on reverse INSERT.)
--
-- Semantics: the confirming creditor becomes debtor on the reverse IOU.
-- Confirming an overpayment is an explicit consent act → reverse IOU is
-- inserted already acknowledged (recipient_acknowledged_at = v_now).
-- ------------------------------------------------------------------------------
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
      id, creator_id, creditor_id, debtor_id, amount, currency, description, status,
      created_at, accepted_at, updated_at, recipient_acknowledged_at
    ) VALUES (
      v_new_iou_id,
      v_parent_iou.debtor_id,
      v_parent_iou.debtor_id,
      v_parent_iou.creditor_id,
      v_excess,
      v_parent_iou.currency,
      v_note_desc,
      'accepted',
      v_now, v_now, v_now,
      v_now  -- A2: confirming creditor is reverse debtor; confirm = acknowledgement
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

-- Privileges
REVOKE EXECUTE ON FUNCTION create_shared_iou(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_shared_iou(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION accept_shared_iou(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION accept_shared_iou(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION reject_shared_iou(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reject_shared_iou(TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION confirm_iou_payment(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_iou_payment(TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- Marker LAST: only persists if this transaction commits (RPC replaces succeeded).
-- ON CONFLICT keeps re-runs idempotent after a successful prior apply.
-- ------------------------------------------------------------------------------
INSERT INTO public.finora_schema_markers (marker, note)
VALUES (
  'phase9_legacy_ack_backfill_v1',
  'One-time: legacy accepted/settled got recipient_acknowledged_at; existing pending left unchanged; Phase 9 RPCs applied.'
)
ON CONFLICT (marker) DO NOTHING;

COMMIT;

-- ------------------------------------------------------------------------------
-- Post-apply verification (run manually after apply; read-only checks)
-- ------------------------------------------------------------------------------
-- 1) SELECT marker FROM finora_schema_markers WHERE marker = 'phase9_legacy_ack_backfill_v1';
-- 2) Existing pending unchanged: SELECT count(*) FROM shared_ious WHERE status = 'pending';
-- 3) Re-run this entire file in one transaction → skip backfill NOTICE; unacked accepted stay NULL.
-- 4) Reject with confirmed payments → cannot_reject_with_payments.
-- 5) Overpay confirm → reverse IOU recipient_acknowledged_at IS NOT NULL.
