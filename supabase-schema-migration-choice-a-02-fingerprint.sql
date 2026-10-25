-- ==============================================================================
-- Choice A batch 02: server fingerprint (fp1) — must match client fixtures
-- Canonicalization: allowlisted fields only; omit updated_at/user_id/dataset_epoch;
-- tables in fixed order; rows sorted by id; object keys sorted in jsonb_strip.
-- DO NOT APPLY until explicitly approved.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.finora_stable_jsonb(p jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE jsonb_typeof(p)
    WHEN 'null' THEN 'null'
    WHEN 'boolean' THEN p::text
    WHEN 'number' THEN p::text
    WHEN 'string' THEN p::text
    WHEN 'array' THEN (
      SELECT coalesce('[' || string_agg(public.finora_stable_jsonb(elem), ',' ORDER BY ord) || ']', '[]')
      FROM jsonb_array_elements(p) WITH ORDINALITY AS t(elem, ord)
    )
    WHEN 'object' THEN (
      SELECT coalesce(
        '{' || string_agg(to_jsonb(key)::text || ':' || public.finora_stable_jsonb(value), ',' ORDER BY key) || '}',
        '{}'
      )
      FROM jsonb_each(p) AS e(key, value)
      WHERE value IS NOT NULL AND value::text <> 'null'
    )
    ELSE p::text
  END;
$$;

-- Strip sync-only keys if present
CREATE OR REPLACE FUNCTION public.finora_strip_sync_keys(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p, '{}'::jsonb)
    - 'updated_at' - 'updatedAt' - 'user_id' - 'userId' - 'dataset_epoch' - 'datasetEpoch';
$$;

CREATE OR REPLACE FUNCTION public.finora_personal_finance_fingerprint(p_uid uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parts text[] := ARRAY[]::text[];
  rec record;
  payload jsonb;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'finora_not_authenticated';
  END IF;

  -- Order MUST match client BACKUP_TABLE_KEYS
  parts := parts || ARRAY['accounts'];
  FOR rec IN
    SELECT * FROM public.accounts a WHERE a.user_id = p_uid ORDER BY a.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_build_object(
      'id', rec.id,
      'name', rec.name,
      'type', rec.type,
      'balance', rec.balance,
      'currency', rec.currency,
      'includeInTotal', rec.include_in_total
    ));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['categories'];
  FOR rec IN
    SELECT * FROM public.categories c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_build_object(
      'id', rec.id,
      'name', rec.name,
      'type', rec.type,
      'icon', rec.icon,
      'color', rec.color
    ));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['transactions'];
  FOR rec IN
    SELECT * FROM public.transactions t WHERE t.user_id = p_uid ORDER BY t.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id,
      'type', rec.type,
      'amount', rec.amount,
      'date', rec.date,
      'accountId', rec.account_id,
      'categoryId', rec.category_id,
      'notes', rec.notes,
      'tagIds', rec.tag_ids,
      'toAccountId', rec.to_account_id,
      'isShared', rec.is_shared,
      'personalAmount', rec.personal_amount,
      'isSettled', rec.is_settled,
      'excludeFromBudget', rec.exclude_from_budget,
      'debtId', rec.debt_id,
      'debtDirection', rec.debt_direction,
      'debtSettlementId', rec.debt_settlement_id
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['budgets'];
  FOR rec IN
    SELECT * FROM public.budgets b WHERE b.user_id = p_uid ORDER BY b.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_build_object(
      'id', rec.id,
      'name', rec.name,
      'amount', rec.amount,
      'period', rec.period,
      'periodLength', rec.period_length,
      'startDate', rec.start_date,
      'endDate', rec.end_date,
      'status', rec.status
    ));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['tags'];
  FOR rec IN
    SELECT * FROM public.tags t WHERE t.user_id = p_uid ORDER BY t.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id,
      'name', rec.name,
      'color', rec.color
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['people'];
  FOR rec IN
    SELECT * FROM public.people p WHERE p.user_id = p_uid ORDER BY p.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id,
      'name', rec.name,
      'connection_id', rec.connection_id
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['debts'];
  FOR rec IN
    SELECT * FROM public.debts d WHERE d.user_id = p_uid ORDER BY d.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id,
      'personId', rec.person_id,
      'personName', rec.person_name,
      'amount', rec.amount,
      'source', rec.source,
      'direction', rec.direction,
      'note', rec.note,
      'settlements', rec.settlements,
      'relatedTransactionId', rec.related_transaction_id,
      'date', rec.date
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['recurringTransactions'];
  FOR rec IN
    SELECT * FROM public.recurring_transactions r WHERE r.user_id = p_uid ORDER BY r.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id,
      'name', rec.name,
      'amount', rec.amount,
      'accountId', rec.account_id,
      'categoryId', rec.category_id,
      'frequency', rec.frequency,
      'nextDueDate', rec.next_due_date,
      'type', rec.type,
      'active', rec.active
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['savingsGoals'];
  FOR rec IN
    SELECT * FROM public.savings_goals g WHERE g.user_id = p_uid ORDER BY g.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id,
      'name', rec.name,
      'targetAmount', rec.target_amount,
      'currentAmount', rec.current_amount,
      'targetDate', rec.target_date,
      'linkedAccountId', rec.linked_account_id,
      'color', rec.color
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['creditCards'];
  FOR rec IN SELECT * FROM public.credit_cards c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id, 'name', rec.name, 'creditLimit', rec.credit_limit,
      'currentBalance', rec.current_balance, 'aprPercent', rec.apr_percent,
      'graceMinDays', rec.grace_min_days, 'graceMaxDays', rec.grace_max_days,
      'dueDate', rec.due_date, 'cycleStartDay', rec.cycle_start_day,
      'isSecuredAgainst', rec.is_secured_against, 'payInFullIntent', rec.pay_in_full_intent
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['cashOffsetSources'];
  FOR rec IN SELECT * FROM public.cash_offset_sources c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id, 'name', rec.name, 'linkedCardId', rec.linked_card_id,
      'expectedMonthlyAmount', rec.expected_monthly_amount, 'category', rec.category
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['fixedDeposits'];
  FOR rec IN SELECT * FROM public.fixed_deposits c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_strip_nulls(jsonb_build_object(
      'id', rec.id, 'name', rec.name, 'principal', rec.principal,
      'ratePercent', rec.rate_percent, 'maturityIntervalMonths', rec.maturity_interval_months,
      'linkedCardId', rec.linked_card_id
    )));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['moneyMarketAccounts'];
  FOR rec IN SELECT * FROM public.money_market_accounts c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    payload := public.finora_strip_sync_keys(jsonb_build_object(
      'id', rec.id, 'name', rec.name, 'balance', rec.balance,
      'currentRatePercent', rec.current_rate_percent,
      'minimumBalanceForRate', rec.minimum_balance_for_rate,
      'baseRatePercent', rec.base_rate_percent
    ));
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(payload)];
  END LOOP;

  parts := parts || ARRAY['installmentPlans'];
  FOR rec IN SELECT to_jsonb(c) - 'user_id' - 'updated_at' - 'dataset_epoch' AS j, c.id
    FROM public.installment_plans c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(public.finora_strip_sync_keys(rec.j))];
  END LOOP;

  parts := parts || ARRAY['cardPromos'];
  FOR rec IN SELECT to_jsonb(c) - 'user_id' - 'updated_at' - 'dataset_epoch' AS j, c.id
    FROM public.card_promos c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(public.finora_strip_sync_keys(rec.j))];
  END LOOP;

  parts := parts || ARRAY['floatGapHistory'];
  FOR rec IN SELECT to_jsonb(c) - 'user_id' - 'updated_at' - 'dataset_epoch' AS j, c.id
    FROM public.float_gap_history c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(public.finora_strip_sync_keys(rec.j))];
  END LOOP;

  parts := parts || ARRAY['reimbursementLedgers'];
  FOR rec IN SELECT to_jsonb(c) - 'user_id' - 'updated_at' - 'dataset_epoch' AS j, c.id
    FROM public.reimbursement_ledgers c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(public.finora_strip_sync_keys(rec.j))];
  END LOOP;

  parts := parts || ARRAY['reimbursementEntries'];
  FOR rec IN SELECT to_jsonb(c) - 'user_id' - 'updated_at' - 'dataset_epoch' AS j, c.id
    FROM public.reimbursement_entries c WHERE c.user_id = p_uid ORDER BY c.id
  LOOP
    parts := parts || ARRAY[rec.id, public.finora_stable_jsonb(public.finora_strip_sync_keys(rec.j))];
  END LOOP;

  RETURN 'fp1:' || array_to_string(parts, '|');
END;
$$;

-- Fingerprint a Choice A / backup-shaped payload (camelCase table keys).
CREATE OR REPLACE FUNCTION public.finora_fingerprint_payload(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  keys text[] := ARRAY[
    'accounts','categories','transactions','budgets','tags','people','debts',
    'recurringTransactions','savingsGoals','creditCards','cashOffsetSources',
    'fixedDeposits','moneyMarketAccounts','installmentPlans','cardPromos',
    'floatGapHistory','reimbursementLedgers','reimbursementEntries'
  ];
  k text;
  parts text[] := ARRAY[]::text[];
  elem jsonb;
  id text;
BEGIN
  FOREACH k IN ARRAY keys LOOP
    parts := parts || ARRAY[k];
    FOR elem IN
      SELECT value FROM jsonb_array_elements(coalesce(p_payload -> k, '[]'::jsonb)) value
      ORDER BY value->>'id'
    LOOP
      id := coalesce(elem->>'id', '');
      parts := parts || ARRAY[id, public.finora_stable_jsonb(public.finora_strip_sync_keys(elem))];
    END LOOP;
  END LOOP;
  RETURN 'fp1:' || array_to_string(parts, '|');
END;
$$;

REVOKE ALL ON FUNCTION public.finora_personal_finance_fingerprint(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finora_personal_finance_fingerprint(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finora_personal_finance_fingerprint(uuid) TO authenticated;
