
-- ============================================================
-- Database Health Monitoring RPCs (system admin only)
-- ============================================================

-- Try to enable pg_stat_statements (may already be enabled)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 1) Table sizes + dead tuples + row count
CREATE OR REPLACE FUNCTION public.db_health_table_stats()
RETURNS TABLE(
  table_name text,
  total_size_bytes bigint,
  table_size_bytes bigint,
  index_size_bytes bigint,
  row_estimate bigint,
  dead_tuples bigint,
  live_tuples bigint,
  last_vacuum timestamptz,
  last_autovacuum timestamptz,
  last_analyze timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  RETURN QUERY
  SELECT
    c.relname::text AS table_name,
    pg_total_relation_size(c.oid)::bigint AS total_size_bytes,
    pg_relation_size(c.oid)::bigint AS table_size_bytes,
    (pg_total_relation_size(c.oid) - pg_relation_size(c.oid))::bigint AS index_size_bytes,
    c.reltuples::bigint AS row_estimate,
    COALESCE(s.n_dead_tup, 0)::bigint AS dead_tuples,
    COALESCE(s.n_live_tup, 0)::bigint AS live_tuples,
    s.last_vacuum,
    s.last_autovacuum,
    s.last_analyze
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY pg_total_relation_size(c.oid) DESC;
END;
$$;

-- 2) Unused / rarely used indexes
CREATE OR REPLACE FUNCTION public.db_health_unused_indexes()
RETURNS TABLE(
  table_name text,
  index_name text,
  index_size_bytes bigint,
  index_scans bigint,
  is_unique boolean,
  is_primary boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  RETURN QUERY
  SELECT
    s.relname::text AS table_name,
    s.indexrelname::text AS index_name,
    pg_relation_size(s.indexrelid)::bigint AS index_size_bytes,
    s.idx_scan::bigint AS index_scans,
    ix.indisunique AS is_unique,
    ix.indisprimary AS is_primary
  FROM pg_stat_user_indexes s
  JOIN pg_index ix ON ix.indexrelid = s.indexrelid
  JOIN pg_namespace n ON n.oid = (SELECT relnamespace FROM pg_class WHERE oid = s.relid)
  WHERE n.nspname = 'public'
  ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC;
END;
$$;

-- 3) Slow queries from pg_stat_statements (top 20 by mean time)
CREATE OR REPLACE FUNCTION public.db_health_slow_queries()
RETURNS TABLE(
  query text,
  calls bigint,
  total_exec_ms double precision,
  mean_exec_ms double precision,
  max_exec_ms double precision,
  rows_returned bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  BEGIN
    RETURN QUERY EXECUTE $q$
      SELECT
        substring(s.query, 1, 500) AS query,
        s.calls,
        s.total_exec_time AS total_exec_ms,
        s.mean_exec_time AS mean_exec_ms,
        s.max_exec_time AS max_exec_ms,
        s.rows AS rows_returned
      FROM pg_stat_statements s
      WHERE s.query NOT ILIKE '%pg_stat_statements%'
        AND s.query NOT ILIKE '%pg_catalog%'
      ORDER BY s.mean_exec_time DESC
      LIMIT 20
    $q$;
  EXCEPTION WHEN undefined_table OR undefined_function THEN
    RETURN; -- pg_stat_statements not available
  END;
END;
$$;

-- 4) Connection / cache summary
CREATE OR REPLACE FUNCTION public.db_health_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_db_size bigint;
  v_active_conns int;
  v_idle_conns int;
  v_cache_hit numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  SELECT pg_database_size(current_database()) INTO v_db_size;
  SELECT count(*) FILTER (WHERE state = 'active'),
         count(*) FILTER (WHERE state = 'idle')
    INTO v_active_conns, v_idle_conns
    FROM pg_stat_activity
    WHERE datname = current_database();
  SELECT round((sum(blks_hit)::numeric / NULLIF(sum(blks_hit) + sum(blks_read), 0)) * 100, 2)
    INTO v_cache_hit
    FROM pg_stat_database
    WHERE datname = current_database();
  RETURN jsonb_build_object(
    'database_size_bytes', v_db_size,
    'active_connections', v_active_conns,
    'idle_connections', v_idle_conns,
    'cache_hit_ratio', COALESCE(v_cache_hit, 0)
  );
END;
$$;

-- 5) VACUUM ANALYZE / REINDEX maintenance (system admin only)
CREATE OR REPLACE FUNCTION public.db_health_run_maintenance(_table_name text, _action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_safe text;
  v_started timestamptz := clock_timestamp();
  v_action text := lower(trim(_action));
BEGIN
  IF v_caller IS NULL OR NOT public.is_system_admin(v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  IF _table_name IS NULL OR _table_name !~ '^[a-z_][a-z0-9_]*$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_table_name');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = _table_name AND c.relkind = 'r'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'table_not_found');
  END IF;
  v_safe := format('%I.%I', 'public', _table_name);
  IF v_action = 'vacuum' THEN
    EXECUTE 'VACUUM ANALYZE ' || v_safe;
  ELSIF v_action = 'analyze' THEN
    EXECUTE 'ANALYZE ' || v_safe;
  ELSIF v_action = 'reindex' THEN
    EXECUTE 'REINDEX TABLE ' || v_safe;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END IF;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail)
  VALUES (
    v_caller, 'db_health_maintenance', 'security', 'table',
    _table_name, _table_name,
    format('Ran %s on public.%s (%.2f ms)', v_action, _table_name,
      EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', v_action,
    'table', _table_name,
    'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.db_health_table_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.db_health_unused_indexes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.db_health_slow_queries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.db_health_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.db_health_run_maintenance(text, text) TO authenticated;
