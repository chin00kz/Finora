-- ==============================================================================
-- Choice A batch 03: epoch triggers + meta/upsert/delete/replace RPCs
--
-- Privileged write context (safer than custom GUC or session_replication_role):
--   Epoch triggers allow DML only when current_user IS DISTINCT FROM session_user
--   (SECURITY DEFINER RPC body). Direct authenticated PostgREST DML has
--   current_user = session_user and is blocked when epoch > 0.
--   At epoch = 0, legacy direct sync is unchanged.
--
-- session_replication_role is NOT used.
-- DO NOT APPLY until explicitly approved. Staging and production share this DB.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.finora_personal_lock(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Two-int form avoids reliance on hashtextextended
  PERFORM pg_advisory_xact_lock(
    87234101,
    ('x' || substr(md5(p_uid::text), 1, 8))::bit(32)::int
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_personal_dataset_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_epoch bigint := 0;
  v_row_uid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'finora_not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.finora_personal_lock(v_uid);

  SELECT m.epoch INTO v_epoch
  FROM public.personal_dataset_meta m
  WHERE m.user_id = v_uid;
  IF NOT FOUND THEN
    v_epoch := 0;
  END IF;

  -- epoch 0: legacy direct sync allowed
  IF v_epoch = 0 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- epoch > 0: only SECURITY DEFINER writers (current_user <> session_user)
  IF current_user IS NOT DISTINCT FROM session_user THEN
    RAISE EXCEPTION 'finora_dataset_epoch_required: Upgrade Finora. Unsynced work can be preserved via Settings → Reconcile with cloud (use cloud).'
      USING ERRCODE = '42501';
  END IF;

  v_row_uid := COALESCE(NEW.user_id, OLD.user_id);
  IF v_row_uid IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'finora_forbidden_cross_user'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','categories','tags','budgets','transactions','recurring_transactions',
    'savings_goals','people','debts','credit_cards','cash_offset_sources','fixed_deposits',
    'money_market_accounts','installment_plans','card_promos','float_gap_history',
    'reimbursement_ledgers','reimbursement_entries'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_finora_personal_epoch ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_finora_personal_epoch
       BEFORE INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_dataset_write()',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Meta / operation status / fingerprint helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_personal_dataset_meta()
RETURNS TABLE (
  epoch bigint,
  last_replaced_at timestamptz,
  last_cloud_fingerprint text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'finora_not_authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM public.finora_personal_lock(v_uid);
  INSERT INTO public.personal_dataset_meta (user_id, epoch)
  VALUES (v_uid, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN QUERY
    SELECT m.epoch, m.last_replaced_at, m.last_cloud_fingerprint
    FROM public.personal_dataset_meta m
    WHERE m.user_id = v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_personal_dataset_operation(p_client_operation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.personal_dataset_operations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'finora_not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.personal_dataset_operations
  WHERE user_id = v_uid AND client_operation_id = p_client_operation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'status', v_row.status,
    'request_hash', v_row.request_hash,
    'expected_cloud_fingerprint', v_row.expected_cloud_fingerprint,
    'local_fingerprint', v_row.local_fingerprint,
    'cloud_fingerprint_after', v_row.cloud_fingerprint_after,
    'epoch_after', v_row.epoch_after,
    'error', v_row.error,
    'committed_at', v_row.committed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_personal_cloud_fingerprint()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'finora_not_authenticated' USING ERRCODE = '42501'; END IF;
  RETURN public.finora_personal_finance_fingerprint(v_uid);
END;
$$;

-- Force ownership + epoch on every upsert row (defeats omitted-column / spoofed user_id)
CREATE OR REPLACE FUNCTION public.finora_force_row_identity(
  p_rows jsonb,
  p_uid uuid,
  p_epoch bigint
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        (elem - 'user_id' - 'userId')
        || jsonb_build_object('user_id', p_uid, 'dataset_epoch', p_epoch)
      )
      FROM jsonb_array_elements(p_rows) elem
    ),
    '[]'::jsonb
  );
$$;

-- ---------------------------------------------------------------------------
-- Epoch-gated upsert / delete (client uses only when localEpoch > 0)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_personal_rows(
  p_epoch bigint,
  p_table text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_meta_epoch bigint;
  v_count int;
  v_rows jsonb;
  v_collision boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'finora_not_authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM public.finora_personal_lock(v_uid);
  INSERT INTO public.personal_dataset_meta (user_id, epoch) VALUES (v_uid, 0) ON CONFLICT DO NOTHING;
  SELECT epoch INTO v_meta_epoch FROM public.personal_dataset_meta WHERE user_id = v_uid;
  IF p_epoch IS DISTINCT FROM v_meta_epoch THEN
    RAISE EXCEPTION 'finora_dataset_epoch_mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_meta_epoch = 0 THEN
    RAISE EXCEPTION 'finora_use_direct_sync_at_epoch_zero' USING ERRCODE = 'P0001';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'finora_invalid_rows';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count > 5000 THEN
    RAISE EXCEPTION 'finora_batch_too_large';
  END IF;

  v_rows := public.finora_force_row_identity(p_rows, v_uid, p_epoch);

  -- Reject cross-user id collisions before write
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_rows) e
    WHERE EXISTS (
      SELECT 1 FROM public.accounts x WHERE p_table = 'accounts' AND x.id = e->>'id' AND x.user_id <> v_uid
    )
    OR EXISTS (
      SELECT 1 FROM public.transactions x WHERE p_table = 'transactions' AND x.id = e->>'id' AND x.user_id <> v_uid
    )
    OR EXISTS (
      SELECT 1 FROM public.categories x WHERE p_table = 'categories' AND x.id = e->>'id' AND x.user_id <> v_uid
    )
  ) THEN
    RAISE EXCEPTION 'finora_id_collision' USING ERRCODE = '42501';
  END IF;

  IF p_table = 'accounts' THEN
    INSERT INTO public.accounts AS t
      SELECT * FROM jsonb_populate_recordset(NULL::public.accounts, v_rows)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, type = EXCLUDED.type, balance = EXCLUDED.balance,
      currency = EXCLUDED.currency, include_in_total = EXCLUDED.include_in_total,
      updated_at = EXCLUDED.updated_at, dataset_epoch = p_epoch, user_id = v_uid
    WHERE t.user_id = v_uid;
  ELSIF p_table = 'transactions' THEN
    INSERT INTO public.transactions AS t
      SELECT * FROM jsonb_populate_recordset(NULL::public.transactions, v_rows)
    ON CONFLICT (id) DO UPDATE SET
      type = EXCLUDED.type, amount = EXCLUDED.amount, date = EXCLUDED.date,
      account_id = EXCLUDED.account_id, category_id = EXCLUDED.category_id,
      notes = EXCLUDED.notes, tag_ids = EXCLUDED.tag_ids, to_account_id = EXCLUDED.to_account_id,
      is_shared = EXCLUDED.is_shared, personal_amount = EXCLUDED.personal_amount,
      is_settled = EXCLUDED.is_settled, exclude_from_budget = EXCLUDED.exclude_from_budget,
      debt_id = EXCLUDED.debt_id, debt_direction = EXCLUDED.debt_direction,
      debt_settlement_id = EXCLUDED.debt_settlement_id, updated_at = EXCLUDED.updated_at,
      dataset_epoch = p_epoch, user_id = v_uid
    WHERE t.user_id = v_uid;
  ELSIF p_table = 'categories' THEN
    INSERT INTO public.categories AS t
      SELECT * FROM jsonb_populate_recordset(NULL::public.categories, v_rows)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, type = EXCLUDED.type, icon = EXCLUDED.icon, color = EXCLUDED.color,
      updated_at = EXCLUDED.updated_at, dataset_epoch = p_epoch, user_id = v_uid
    WHERE t.user_id = v_uid;
  ELSIF p_table = 'tags' THEN
    INSERT INTO public.tags AS t
      SELECT * FROM jsonb_populate_recordset(NULL::public.tags, v_rows)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, color = EXCLUDED.color, updated_at = EXCLUDED.updated_at,
      dataset_epoch = p_epoch, user_id = v_uid
    WHERE t.user_id = v_uid;
  ELSIF p_table = 'budgets' THEN
    INSERT INTO public.budgets AS t
      SELECT * FROM jsonb_populate_recordset(NULL::public.budgets, v_rows)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, amount = EXCLUDED.amount, period = EXCLUDED.period,
      period_length = EXCLUDED.period_length, start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at,
      dataset_epoch = p_epoch, user_id = v_uid
    WHERE t.user_id = v_uid;
  ELSIF p_table IN (
    'recurring_transactions','savings_goals','people','debts','credit_cards',
    'cash_offset_sources','fixed_deposits','money_market_accounts','installment_plans',
    'card_promos','float_gap_history','reimbursement_ledgers','reimbursement_entries'
  ) THEN
    -- Replace rows by id for this user only (identity already forced on v_rows).
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM jsonb_array_elements($1) e
         WHERE EXISTS (
           SELECT 1 FROM public.%I o
           WHERE o.id = e->>''id'' AND o.user_id IS DISTINCT FROM $2
         )
       )',
      p_table
    ) INTO v_collision USING v_rows, v_uid;
    IF v_collision THEN
      RAISE EXCEPTION 'finora_id_collision' USING ERRCODE = '42501';
    END IF;
    EXECUTE format(
      'DELETE FROM public.%I
       WHERE user_id = $1
         AND id IN (SELECT e->>''id'' FROM jsonb_array_elements($2) e)',
      p_table
    ) USING v_uid, v_rows;
    EXECUTE format(
      'INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(NULL::public.%I, $1)',
      p_table, p_table
    ) USING v_rows;
  ELSE
    RAISE EXCEPTION 'finora_invalid_table';
  END IF;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_personal_rows(
  p_epoch bigint,
  p_table text,
  p_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_meta_epoch bigint;
  v_deleted int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'finora_not_authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM public.finora_personal_lock(v_uid);
  SELECT epoch INTO v_meta_epoch FROM public.personal_dataset_meta WHERE user_id = v_uid;
  IF p_epoch IS DISTINCT FROM coalesce(v_meta_epoch, 0) THEN
    RAISE EXCEPTION 'finora_dataset_epoch_mismatch' USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_meta_epoch, 0) = 0 THEN
    RAISE EXCEPTION 'finora_use_direct_sync_at_epoch_zero';
  END IF;
  IF p_table NOT IN (
    'accounts','categories','tags','budgets','transactions','recurring_transactions',
    'savings_goals','people','debts','credit_cards','cash_offset_sources','fixed_deposits',
    'money_market_accounts','installment_plans','card_promos','float_gap_history',
    'reimbursement_ledgers','reimbursement_entries'
  ) THEN
    RAISE EXCEPTION 'finora_invalid_table';
  END IF;
  EXECUTE format(
    'DELETE FROM public.%I WHERE user_id = $1 AND id = ANY($2)',
    p_table
  ) USING v_uid, p_ids;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic Choice A replace (single-shot JSONB, camelCase backup keys)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_personal_finance_dataset(
  p_client_operation_id text,
  p_expected_cloud_fingerprint text,
  p_local_fingerprint text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.personal_dataset_operations%ROWTYPE;
  v_request_hash text;
  v_cloud_fp text;
  v_payload_fp text;
  v_total_rows bigint := 0;
  v_epoch bigint;
  v_new_epoch bigint;
  v_fp_after text;
  k text;
  keys text[] := ARRAY[
    'accounts','categories','transactions','budgets','tags','people','debts',
    'recurringTransactions','savingsGoals','creditCards','cashOffsetSources',
    'fixedDeposits','moneyMarketAccounts','installmentPlans','cardPromos',
    'floatGapHistory','reimbursementLedgers','reimbursementEntries'
  ];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'finora_not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_client_operation_id IS NULL OR length(trim(p_client_operation_id)) < 8 THEN
    RAISE EXCEPTION 'finora_invalid_operation_id';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'finora_invalid_payload';
  END IF;
  IF octet_length(p_payload::text) > 2097152 THEN
    RAISE EXCEPTION 'finora_payload_too_large';
  END IF;

  PERFORM public.finora_personal_lock(v_uid);
  INSERT INTO public.personal_dataset_meta (user_id, epoch) VALUES (v_uid, 0) ON CONFLICT DO NOTHING;

  -- Built-in md5 (no pgcrypto dependency); collision resistance not required for op ledger
  v_request_hash := md5(
    p_payload::text || '|' || p_expected_cloud_fingerprint || '|' || p_local_fingerprint
  );

  SELECT * INTO v_existing FROM public.personal_dataset_operations
  WHERE user_id = v_uid AND client_operation_id = p_client_operation_id;
  IF FOUND AND v_existing.status = 'committed' THEN
    IF v_existing.request_hash = v_request_hash THEN
      RETURN jsonb_build_object(
        'status', 'committed',
        'idempotent', true,
        'epoch', v_existing.epoch_after,
        'cloud_fingerprint_after', v_existing.cloud_fingerprint_after,
        'client_operation_id', p_client_operation_id
      );
    END IF;
    RAISE EXCEPTION 'finora_operation_id_reuse_conflict';
  END IF;

  FOREACH k IN ARRAY keys LOOP
    v_total_rows := v_total_rows + coalesce(jsonb_array_length(p_payload -> k), 0);
  END LOOP;
  IF v_total_rows = 0 THEN
    RAISE EXCEPTION 'finora_empty_dataset_forbidden';
  END IF;
  IF v_total_rows > 50000 THEN
    RAISE EXCEPTION 'finora_too_many_rows';
  END IF;

  v_cloud_fp := public.finora_personal_finance_fingerprint(v_uid);
  IF v_cloud_fp IS DISTINCT FROM p_expected_cloud_fingerprint THEN
    INSERT INTO public.personal_dataset_operations (
      user_id, client_operation_id, request_hash, expected_cloud_fingerprint,
      local_fingerprint, status, error
    ) VALUES (
      v_uid, p_client_operation_id, v_request_hash, p_expected_cloud_fingerprint,
      p_local_fingerprint, 'aborted_stale', 'cloud fingerprint mismatch'
    )
    ON CONFLICT (user_id, client_operation_id) DO UPDATE
      SET status = 'aborted_stale', error = 'cloud fingerprint mismatch';
    RETURN jsonb_build_object(
      'status', 'aborted_stale',
      'cloud_fingerprint', v_cloud_fp,
      'expected', p_expected_cloud_fingerprint
    );
  END IF;

  v_payload_fp := public.finora_fingerprint_payload(p_payload);
  IF v_payload_fp IS DISTINCT FROM p_local_fingerprint THEN
    RAISE EXCEPTION 'finora_local_fingerprint_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(p_payload->'transactions','[]'::jsonb)) t
    WHERE coalesce(t->>'accountId','') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'accounts','[]'::jsonb)) a
        WHERE a->>'id' = t->>'accountId'
      )
  ) THEN
    RAISE EXCEPTION 'finora_invalid_account_ref';
  END IF;

  -- Cross-user id collision across all core ids in payload
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'accounts','[]'::jsonb)) e
    WHERE EXISTS (SELECT 1 FROM public.accounts x WHERE x.id = e->>'id' AND x.user_id <> v_uid)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'transactions','[]'::jsonb)) e
    WHERE EXISTS (SELECT 1 FROM public.transactions x WHERE x.id = e->>'id' AND x.user_id <> v_uid)
  ) THEN
    RAISE EXCEPTION 'finora_id_collision';
  END IF;

  SELECT epoch INTO v_epoch FROM public.personal_dataset_meta WHERE user_id = v_uid;
  v_new_epoch := v_epoch + 1;

  DELETE FROM public.reimbursement_entries WHERE user_id = v_uid;
  DELETE FROM public.reimbursement_ledgers WHERE user_id = v_uid;
  DELETE FROM public.float_gap_history WHERE user_id = v_uid;
  DELETE FROM public.card_promos WHERE user_id = v_uid;
  DELETE FROM public.installment_plans WHERE user_id = v_uid;
  DELETE FROM public.money_market_accounts WHERE user_id = v_uid;
  DELETE FROM public.fixed_deposits WHERE user_id = v_uid;
  DELETE FROM public.cash_offset_sources WHERE user_id = v_uid;
  DELETE FROM public.credit_cards WHERE user_id = v_uid;
  DELETE FROM public.debts WHERE user_id = v_uid;
  DELETE FROM public.people WHERE user_id = v_uid;
  DELETE FROM public.savings_goals WHERE user_id = v_uid;
  DELETE FROM public.recurring_transactions WHERE user_id = v_uid;
  DELETE FROM public.transactions WHERE user_id = v_uid;
  DELETE FROM public.budgets WHERE user_id = v_uid;
  DELETE FROM public.tags WHERE user_id = v_uid;
  DELETE FROM public.categories WHERE user_id = v_uid;
  DELETE FROM public.accounts WHERE user_id = v_uid;

  INSERT INTO public.accounts (id, user_id, name, type, balance, currency, include_in_total, updated_at, dataset_epoch)
  SELECT e->>'id', v_uid, e->>'name', coalesce(e->>'type','bank'),
         coalesce((e->>'balance')::numeric, 0), coalesce(e->>'currency','LKR'),
         coalesce((e->>'includeInTotal')::boolean, true),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'accounts','[]'::jsonb)) e;

  INSERT INTO public.categories (id, user_id, name, type, icon, color, updated_at, dataset_epoch)
  SELECT e->>'id', v_uid, e->>'name', coalesce(e->>'type','expense'),
         coalesce(e->>'icon','tag'), coalesce(e->>'color','#3b82f6'),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'categories','[]'::jsonb)) e;

  INSERT INTO public.tags (id, user_id, name, color, updated_at, dataset_epoch)
  SELECT e->>'id', v_uid, e->>'name', e->>'color',
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'tags','[]'::jsonb)) e;

  INSERT INTO public.budgets (id, user_id, name, amount, period, period_length, start_date, end_date, status, updated_at, dataset_epoch)
  SELECT e->>'id', v_uid, e->>'name', coalesce((e->>'amount')::numeric, 0),
         coalesce(e->>'period','days'), coalesce((e->>'periodLength')::int, 1),
         coalesce((e->>'startDate')::bigint, 0), coalesce((e->>'endDate')::bigint, 0),
         coalesce(e->>'status','active'), coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'budgets','[]'::jsonb)) e;

  INSERT INTO public.transactions (
    id, user_id, type, amount, date, account_id, category_id, notes, tag_ids, to_account_id,
    is_shared, personal_amount, is_settled, exclude_from_budget, debt_id, debt_direction,
    debt_settlement_id, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, coalesce(e->>'type','expense'), coalesce((e->>'amount')::numeric, 0),
         coalesce((e->>'date')::bigint, 0), e->>'accountId', e->>'categoryId', e->>'notes',
         e->'tagIds', e->>'toAccountId', (e->>'isShared')::boolean, (e->>'personalAmount')::numeric,
         (e->>'isSettled')::boolean, (e->>'excludeFromBudget')::boolean, e->>'debtId',
         e->>'debtDirection', e->>'debtSettlementId', coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'transactions','[]'::jsonb)) e;

  INSERT INTO public.people (id, user_id, name, connection_id, updated_at, dataset_epoch)
  SELECT e->>'id', v_uid, e->>'name', e->>'connection_id',
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'people','[]'::jsonb)) e;

  INSERT INTO public.debts (
    id, user_id, person_id, person_name, amount, source, direction, note, settlements,
    related_transaction_id, date, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'personId', coalesce(e->>'personName','Friend'),
         coalesce((e->>'amount')::numeric, 0), coalesce(e->>'source','manual'),
         coalesce(e->>'direction','theyOweMe'), e->>'note', coalesce(e->'settlements','[]'::jsonb),
         e->>'relatedTransactionId', coalesce((e->>'date')::bigint, 0),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'debts','[]'::jsonb)) e;

  INSERT INTO public.recurring_transactions (
    id, user_id, name, amount, account_id, category_id, frequency, next_due_date, type, active, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'name', coalesce((e->>'amount')::numeric, 0), e->>'accountId',
         e->>'categoryId', e->>'frequency', coalesce((e->>'nextDueDate')::bigint, 0),
         e->>'type', coalesce((e->>'active')::boolean, true),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'recurringTransactions','[]'::jsonb)) e;

  INSERT INTO public.savings_goals (
    id, user_id, name, target_amount, current_amount, target_date, linked_account_id, color, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'name', coalesce((e->>'targetAmount')::numeric, 0),
         coalesce((e->>'currentAmount')::numeric, 0), (e->>'targetDate')::bigint,
         e->>'linkedAccountId', e->>'color', coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'savingsGoals','[]'::jsonb)) e;

  INSERT INTO public.credit_cards (
    id, user_id, name, credit_limit, current_balance, apr_percent, grace_min_days, grace_max_days,
    due_date, cycle_start_day, is_secured_against, pay_in_full_intent, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'name', coalesce((e->>'creditLimit')::numeric, 0),
         coalesce((e->>'currentBalance')::numeric, 0), coalesce((e->>'aprPercent')::numeric, 0),
         coalesce((e->>'graceMinDays')::int, 0), coalesce((e->>'graceMaxDays')::int, 0),
         coalesce((e->>'dueDate')::bigint, 0), coalesce((e->>'cycleStartDay')::int, 1),
         e->>'isSecuredAgainst', coalesce((e->>'payInFullIntent')::boolean, true),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'creditCards','[]'::jsonb)) e;

  INSERT INTO public.cash_offset_sources (
    id, user_id, name, linked_card_id, expected_monthly_amount, category, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'name', e->>'linkedCardId',
         coalesce((e->>'expectedMonthlyAmount')::numeric, 0), e->>'category',
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'cashOffsetSources','[]'::jsonb)) e;

  INSERT INTO public.fixed_deposits (
    id, user_id, name, principal, rate_percent, maturity_interval_months, linked_card_id, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'name', coalesce((e->>'principal')::numeric, 0),
         coalesce((e->>'ratePercent')::numeric, 0), coalesce((e->>'maturityIntervalMonths')::int, 12),
         e->>'linkedCardId', coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'fixedDeposits','[]'::jsonb)) e;

  INSERT INTO public.money_market_accounts (
    id, user_id, name, balance, current_rate_percent, minimum_balance_for_rate, base_rate_percent, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'name', coalesce((e->>'balance')::numeric, 0),
         coalesce((e->>'currentRatePercent')::numeric, 0),
         coalesce((e->>'minimumBalanceForRate')::numeric, 0),
         coalesce((e->>'baseRatePercent')::numeric, 0),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'moneyMarketAccounts','[]'::jsonb)) e;

  INSERT INTO public.installment_plans (
    id, user_id, linked_card_id, description, total_amount, monthly_amount, total_months, months_paid, active, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'linkedCardId', e->>'description',
         coalesce((e->>'totalAmount')::numeric, 0), coalesce((e->>'monthlyAmount')::numeric, 0),
         coalesce((e->>'totalMonths')::int, 1), coalesce((e->>'monthsPaid')::int, 0),
         coalesce((e->>'active')::boolean, true), coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'installmentPlans','[]'::jsonb)) e;

  INSERT INTO public.card_promos (
    id, user_id, linked_card_id, description, spend_threshold, min_transaction_count,
    window_start, window_end, cashback_percent, cashback_cap, current_spend, current_transaction_count,
    updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'linkedCardId', e->>'description',
         coalesce((e->>'spendThreshold')::numeric, 0), coalesce((e->>'minTransactionCount')::int, 0),
         coalesce((e->>'windowStart')::bigint, 0), coalesce((e->>'windowEnd')::bigint, 0),
         coalesce((e->>'cashbackPercent')::numeric, 0), coalesce((e->>'cashbackCap')::numeric, 0),
         coalesce((e->>'currentSpend')::numeric, 0), coalesce((e->>'currentTransactionCount')::int, 0),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'cardPromos','[]'::jsonb)) e;

  INSERT INTO public.float_gap_history (
    id, user_id, card_id, cycle_label, total_bill, cash_received, delta, cumulative_gap, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'cardId', e->>'cycleLabel',
         coalesce((e->>'totalBill')::numeric, 0), coalesce((e->>'cashReceived')::numeric, 0),
         coalesce((e->>'delta')::numeric, 0), coalesce((e->>'cumulativeGap')::numeric, 0),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'floatGapHistory','[]'::jsonb)) e;

  INSERT INTO public.reimbursement_ledgers (
    id, user_id, counterparty_name, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'counterpartyName',
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'reimbursementLedgers','[]'::jsonb)) e;

  INSERT INTO public.reimbursement_entries (
    id, user_id, ledger_id, date, note, amount_owed, amount_paid, delta, updated_at, dataset_epoch
  )
  SELECT e->>'id', v_uid, e->>'ledgerId', coalesce((e->>'date')::bigint, 0),
         coalesce(e->>'note',''), coalesce((e->>'amountOwed')::numeric, 0),
         coalesce((e->>'amountPaid')::numeric, 0), coalesce((e->>'delta')::numeric, 0),
         coalesce((e->>'updatedAt')::bigint, 0), v_new_epoch
  FROM jsonb_array_elements(coalesce(p_payload->'reimbursementEntries','[]'::jsonb)) e;

  v_fp_after := public.finora_personal_finance_fingerprint(v_uid);

  UPDATE public.personal_dataset_meta
  SET epoch = v_new_epoch,
      last_replaced_at = now(),
      last_operation_id = p_client_operation_id,
      last_cloud_fingerprint = v_fp_after,
      updated_at = now()
  WHERE user_id = v_uid;

  INSERT INTO public.personal_dataset_operations (
    user_id, client_operation_id, request_hash, expected_cloud_fingerprint, local_fingerprint,
    status, cloud_fingerprint_after, epoch_after, committed_at
  ) VALUES (
    v_uid, p_client_operation_id, v_request_hash, p_expected_cloud_fingerprint, p_local_fingerprint,
    'committed', v_fp_after, v_new_epoch, now()
  )
  ON CONFLICT (user_id, client_operation_id) DO UPDATE SET
    status = 'committed',
    cloud_fingerprint_after = EXCLUDED.cloud_fingerprint_after,
    epoch_after = EXCLUDED.epoch_after,
    committed_at = EXCLUDED.committed_at,
    request_hash = EXCLUDED.request_hash;

  RETURN jsonb_build_object(
    'status', 'committed',
    'idempotent', false,
    'epoch', v_new_epoch,
    'cloud_fingerprint_after', v_fp_after,
    'client_operation_id', p_client_operation_id,
    'restored_rows', v_total_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finora_personal_lock(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finora_force_row_identity(jsonb, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_personal_dataset_meta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_personal_dataset_meta() TO authenticated;
REVOKE ALL ON FUNCTION public.get_personal_dataset_operation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_personal_dataset_operation(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_personal_cloud_fingerprint() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_personal_cloud_fingerprint() TO authenticated;
REVOKE ALL ON FUNCTION public.upsert_personal_rows(bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_personal_rows(bigint, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_personal_rows(bigint, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_personal_rows(bigint, text, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.replace_personal_finance_dataset(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_personal_finance_dataset(text, text, text, jsonb) TO authenticated;
