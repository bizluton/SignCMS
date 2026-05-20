# Pre-flight checklist — playback_logs partition cutover

> 配合 `docs/runbooks/playback-logs-partition-cutover.md`（實際操作）。
> 本檔列出**正式維護窗口前可以做、不影響 prod 的所有準備動作**。
> 跑完這份，正式 cutover 的時間能縮短到 5–15 分鐘。

## 0. 為何要先做這些

正式 cutover 是有時間壓力的（阻擋寫入、複製資料、swap names）。任何
事前能驗證的，事先驗：節省維護窗口時間 + 降低意外。

## 1. 衡量資料量（任何時間可跑）

決定走「路徑 A / B / C」哪一條。

```sql
-- (a) 列數與 heap 大小
SELECT
  count(*)                                          AS row_count,
  pg_size_pretty(pg_relation_size('public.playback_logs'))  AS heap,
  pg_size_pretty(pg_total_relation_size('public.playback_logs')) AS total_incl_indexes
FROM public.playback_logs;

-- (b) 寫入速率（看一段時間內的新增）
SELECT
  date_trunc('hour', played_at) AS hr,
  count(*)
FROM public.playback_logs
WHERE played_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 24;

-- (c) 最舊資料
SELECT min(played_at), max(played_at) FROM public.playback_logs;
```

決策表：

| row_count | heap | 走哪條路徑 | 維護窗口 |
|---|---|---|---|
| < 10M | < 5 GB | **A: one-shot 切換** | 5–15 min |
| 10M–100M | 5–50 GB | **B: dual-write trigger** | 5 min cutover，前置 1 週分批 backfill |
| > 100M | > 50 GB | **C: 暫不 partition，繼續 batched DELETE** | N/A |

## 2. 鎖定 cutover 候選日（>=7 天前）

- [ ] 找 prod 流量最低時段（通常 02:00–04:00 local time）
- [ ] 通知工程 / CS：當天會短暫阻擋 playback_logs 寫入（player 端有 retry 不會 lost）
- [ ] 預留 30 分鐘 buffer，實際做完通常 ≤ 15 分鐘

## 3. Migration 已部署（可立刻檢查）

```sql
-- 三個管理函式存在？
SELECT proname FROM pg_proc WHERE proname IN (
  'ensure_playback_logs_partition',
  'create_next_playback_logs_partitions',
  'drop_oldest_playback_logs_partition'
);
-- 預期 3 列

-- pg_cron job 已排（cutover 前 no-op）
SELECT jobname, schedule, command
  FROM cron.job WHERE jobname = 'playback-logs-partition-prep';
-- 應該 1 列、 schedule '0 0 1 * *'
```

如果上述任何一個 0 列，先補跑 `20260521000006_playback_logs_partitioning_infrastructure.sql`。

## 4. Staging dry-run（cutover 前 1–3 天）

把整套 cutover 在 staging 跑一次：

- [ ] **複製 prod schema + 一份 dataset sample 到 staging**（至少 100K 列代表性資料）
- [ ] 跑路徑 A 的所有 SQL（從 `BEGIN;` 到 `COMMIT;`）
- [ ] 計時：每階段花多久
- [ ] 驗證腳本（見 §6）也跑一次
- [ ] 結果若 OK → prod 同樣的 SQL 直接 reuse

特別注意：staging 的 `screens`、`media_items`、`organizations` 等
**外鍵目標表**必須跟 prod 同 schema，否則 `LIKE INCLUDING CONSTRAINTS`
複製出來的 FK 會指向不存在的 row。

## 5. 預先準備的 SQL 腳本（cutover 當下直接 paste）

```sql
-- ════════════════════════════════════════════════════════════════════
-- ▼▼▼ 預先準備好的 cutover SQL（路徑 A）
-- 維護窗口開始時把整段 paste 進 Supabase SQL Editor 或 psql
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- (1) 建立空白分區表
CREATE TABLE public.playback_logs_new (
  LIKE public.playback_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS
) PARTITION BY RANGE (played_at);

-- (2) 預建 partition：前 6 個月 + 本月 + 未來 2 個月
DO $$
DECLARE
  m   date;
  pname text;
BEGIN
  FOR m IN
    SELECT (date_trunc('month', now()) + (i || ' months')::interval)::date
      FROM generate_series(-6, 2) i
  LOOP
    pname := format('playback_logs_new_y%sm%s',
                     to_char(m, 'YYYY'), to_char(m, 'MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.playback_logs_new
         FOR VALUES FROM (%L) TO (%L)',
      pname, m, m + interval '1 month'
    );
  END LOOP;
END
$$;

-- (3) 複製資料
INSERT INTO public.playback_logs_new
     SELECT * FROM public.playback_logs;

-- (4) 重建主表層 indexes（自動推到每個 partition）
CREATE INDEX ON public.playback_logs_new (org_id, played_at DESC);
CREATE INDEX ON public.playback_logs_new (screen_id, played_at DESC);
CREATE INDEX ON public.playback_logs_new (media_id);
CREATE INDEX ON public.playback_logs_new (played_at);

-- (5) RLS
ALTER TABLE public.playback_logs_new ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r record;
  sql text;
BEGIN
  FOR r IN
    SELECT polname,
           pg_get_expr(polqual, polrelid) AS using_expr,
           pg_get_expr(polwithcheck, polrelid) AS check_expr,
           polcmd
      FROM pg_policy
     WHERE polrelid = 'public.playback_logs'::regclass
  LOOP
    sql := format(
      'CREATE POLICY %I ON public.playback_logs_new FOR %s TO authenticated',
      r.polname,
      CASE r.polcmd WHEN 'r' THEN 'SELECT'
                    WHEN 'a' THEN 'INSERT'
                    WHEN 'w' THEN 'UPDATE'
                    WHEN 'd' THEN 'DELETE'
                    ELSE 'ALL' END
    );
    IF r.using_expr IS NOT NULL THEN sql := sql || format(' USING (%s)',      r.using_expr); END IF;
    IF r.check_expr IS NOT NULL THEN sql := sql || format(' WITH CHECK (%s)', r.check_expr); END IF;
    EXECUTE sql;
  END LOOP;
END
$$;

-- (6) Swap names
ALTER TABLE public.playback_logs     RENAME TO playback_logs_old;
ALTER TABLE public.playback_logs_new RENAME TO playback_logs;

-- (7) Realtime publication（如果之前有用 Realtime 訂閱）
-- 跳過如不適用：
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.playback_logs_old;
-- ALTER PUBLICATION supabase_realtime ADD  TABLE public.playback_logs;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- ▼ 切換 cron 到 partition-friendly retention
-- ════════════════════════════════════════════════════════════════════
SELECT cron.unschedule('playback-logs-retention');
SELECT cron.schedule(
  'playback-logs-retention',
  '0 3 * * *',
  $sql$SELECT public.drop_oldest_playback_logs_partition((now() - INTERVAL '90 days')::date)$sql$
);
```

## 6. 驗證腳本（cutover 後立即跑）

```sql
-- (a) playback_logs 確實是 partitioned
SELECT
  c.relname,
  CASE WHEN pt.partrelid IS NOT NULL THEN 'partitioned' ELSE 'heap' END AS kind
FROM pg_class c
LEFT JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
WHERE c.relname = 'playback_logs';
-- 預期：partitioned

-- (b) partition 列表
SELECT child.relname, pg_get_expr(child.relpartbound, child.oid)
  FROM pg_inherits i
  JOIN pg_class parent ON parent.oid = i.inhparent
  JOIN pg_class child  ON child.oid  = i.inhrelid
 WHERE parent.relname = 'playback_logs'
 ORDER BY child.relname;
-- 預期：至少 9 個 partition（過去 6 月 + 本月 + 未來 2 月）

-- (c) 列數與 old 表一致
SELECT
  (SELECT count(*) FROM public.playback_logs) AS new_count,
  (SELECT count(*) FROM public.playback_logs_old) AS old_count;
-- 預期相等

-- (d) Sample 一致性
WITH new_sample AS (SELECT id FROM public.playback_logs ORDER BY id LIMIT 5),
     old_sample AS (SELECT id FROM public.playback_logs_old WHERE id IN (SELECT id FROM new_sample))
SELECT
  (SELECT count(*) FROM new_sample) AS new_n,
  (SELECT count(*) FROM old_sample) AS old_n;
-- 預期相等

-- (e) RLS policy 都在
SELECT polname FROM pg_policy WHERE polrelid = 'public.playback_logs'::regclass;
-- 預期：所有原本的 policy 都複製過來

-- (f) 寫入測試
INSERT INTO public.playback_logs (screen_id, org_id, media_id, media_name, duration_seconds, played_at)
SELECT screen_id, org_id, media_id, media_name, duration_seconds, played_at
  FROM public.playback_logs_old LIMIT 1;
-- 確認新表能 insert

-- (g) 計畫查詢走 partition
EXPLAIN ANALYZE
SELECT * FROM public.playback_logs
 WHERE org_id = '<some org uuid>'
   AND played_at > now() - interval '7 days'
 LIMIT 100;
-- 預期：Plan 顯示 partition pruning（"Append" + 只掃近期 partition）
```

## 7. 觀察期（cutover 後 24h）

- [ ] player-sync edge function error rate 沒上升
- [ ] playback_logs INSERT rate 正常（用 `pg_stat_user_tables.n_tup_ins`）
- [ ] retention cron 每天 03:00 跑成功（看 `cron.job_run_details`）
- [ ] storage 使用量開始下降（舊 partition 被 DROP）

## 8. 退場（cutover 後 ≥ 24h、確認 OK 再做）

```sql
-- 保險起見的最後 sanity
SELECT
  (SELECT count(*) FROM public.playback_logs WHERE played_at < (SELECT max(played_at) FROM public.playback_logs_old)) AS in_new,
  (SELECT count(*) FROM public.playback_logs_old) AS in_old;
-- 兩者應接近相等（cutover 後可能多了新進來的列）

-- OK → DROP old
DROP TABLE public.playback_logs_old;
```

## 9. 回滾（cutover 後發現問題）

```sql
BEGIN;
ALTER TABLE public.playback_logs     RENAME TO playback_logs_failed;
ALTER TABLE public.playback_logs_old RENAME TO playback_logs;
COMMIT;

-- 還原舊 retention cron
SELECT cron.unschedule('playback-logs-retention');
SELECT cron.schedule(
  'playback-logs-retention',
  '0 3 * * *',
  $sql$SELECT public.purge_playback_logs_batched()$sql$
);
```

`_failed` 表保留 7 天用於 forensics，再 DROP。

## 10. 完成條件

- [ ] §6 驗證腳本全部通過
- [ ] §7 24h 觀察無異狀
- [ ] §8 已 DROP 舊表
- [ ] 在團隊文件 / Slack 公告 cutover 完成 + retention 改用 DROP PARTITION
- [ ] 把 P3-6 / Scale-4 標記為已完成

預估**整段準備 + 執行 + 驗證 = 1 個工作天**。實際 prod down-time
（阻擋寫入到 swap 完成）= **5–15 分鐘**。
