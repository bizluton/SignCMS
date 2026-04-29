-- Drop indexes that are made redundant by existing composite indexes.
--
-- Composite index (col_a, col_b) satisfies all queries that a single-column
-- index on col_a would answer, so the narrow index adds write overhead with
-- no read benefit.
--
-- To revert: re-create the dropped indexes (see comments next to each DROP).

-- idx_channels_org_id (org_id) is fully covered by idx_channels_org_sort (org_id, sort_order)
DROP INDEX IF EXISTS public.idx_channels_org_id;

-- idx_activity_logs_user_id (user_id) is fully covered by idx_activity_logs_user_created (user_id, created_at DESC)
DROP INDEX IF EXISTS public.idx_activity_logs_user_id;

-- idx_delegation_grants_grantee (grantee_id, status) is an exact duplicate of idx_delegation_grants_grantee_status
DROP INDEX IF EXISTS public.idx_delegation_grants_grantee;

-- idx_delegation_grants_grantor (grantor_id, status) is an exact duplicate of idx_delegation_grants_grantor_status
DROP INDEX IF EXISTS public.idx_delegation_grants_grantor;
