# Runbook: `playback_logs` → monthly partitioning cutover

> **這不是日常 deploy 跑的 migration**。需要短暫的維護窗口、阻擋寫入、
> 複製資料、改名 swap。完成後 retention 就從「分批 DELETE」變成
> 「DROP PARTITION」（毫秒級）。

## 前置條件

1. `20260521000006_playback_logs_partitioning_infrastructure.sql` 已部署
   （三個 SECURITY DEFINER helper + 月底 cron 已 schedule，但對未分區
   表格 no-op）。
2. 評估資料量：

   ```sql
   SELECT count(*), pg_size_pretty(pg_relation_size('public.playback_logs')) AS heap_size
     FROM public.playback_logs;
   ```

   - **< 10M 列 / < 5 GB**：one-shot 切換可行（單次 maintenance ~5 min）
   - **10M–100M 列**：建議 dual-write 過渡（pre-load 歷史 partition + 切讀 + 後續清舊表）
   - **> 100M 列**：強烈建議停服務分批，或評估保留 retention DELETE 策略

3. 找一個低流量時段（player 寫入較少）。

## 路徑 A：one-shot 切換（< 10M 列）

維護窗口預估 5–15 min。

### A.1 阻擋寫入（可選但建議）

把 `screen_logs` / 後台 ingest 設成 dry-run 或暫停。Player 端 `player-sync`
edge function 在這期間會把 playback_logs INSERT 失敗的 record 丟回 player
做 retry——只要窗口不長就 OK。

### A.2 建立新分區表

```sql
BEGIN;

CREATE TABLE public.playback_logs_new (
  LIKE public.playback_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS
) PARTITION BY RANGE (played_at);

-- 建立過去半年 + 當月 + 未來 2 個月的 partition
SELECT public.ensure_playback_logs_partition(
  (date_trunc('month', now()) - (i || ' months')::interval)::date
)
  FROM generate_series(-2, 6) i;   -- 未來 2 月、本月、回溯 6 個月

-- 上面 cron-friendly helper 在 _new 還沒生效時不會找到 pg_partitioned_table
-- 條目；本步驟需要手動建立 partition：
DO $$
DECLARE
  m   date;
  pname text;
BEGIN
  FOR m IN
    SELECT (date_trunc('month', now()) - (i || ' months')::interval)::date
      FROM generate_series(-2, 12) i
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

-- 複製資料（一次性大 INSERT；可分批 ID 區段以降低 lock）
INSERT INTO public.playback_logs_new
     SELECT * FROM public.playback_logs;

-- 重建 indexes（partial / 複合的需要逐個 partition 建；也可在主表層 CREATE
-- INDEX 由 PG 自動推到每個 child）
CREATE INDEX ON public.playback_logs_new (org_id, played_at DESC);
CREATE INDEX ON public.playback_logs_new (screen_id, played_at DESC);
CREATE INDEX ON public.playback_logs_new (media_id);
CREATE INDEX ON public.playback_logs_new (played_at);

-- RLS：複製原表 policy
ALTER TABLE public.playback_logs_new ENABLE ROW LEVEL SECURITY;

-- 從原表抓現行 policy 文字並在 _new 上 re-create
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

-- Swap
ALTER TABLE public.playback_logs     RENAME TO playback_logs_old;
ALTER TABLE public.playback_logs_new RENAME TO playback_logs;

-- 重新 attach realtime publication (如果原本有)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.playback_logs;

COMMIT;
```

### A.3 驗證

```sql
-- partition 列表
SELECT child.relname, pg_get_expr(child.relpartbound, child.oid)
  FROM pg_inherits i
  JOIN pg_class parent ON parent.oid = i.inhparent
  JOIN pg_class child  ON child.oid  = i.inhrelid
 WHERE parent.relname = 'playback_logs'
 ORDER BY child.relname;

-- 列數應與原 _old 表相同
SELECT count(*) FROM public.playback_logs;
SELECT count(*) FROM public.playback_logs_old;

-- 隨機 sample 比對 row 一致
SELECT * FROM public.playback_logs ORDER BY played_at DESC LIMIT 5;
```

### A.4 切換 retention cron

```sql
SELECT cron.unschedule('playback-logs-retention');
SELECT cron.schedule(
  'playback-logs-retention',
  '0 3 * * *',
  $sql$SELECT public.drop_oldest_playback_logs_partition((now() - INTERVAL '90 days')::date)$sql$
);
```

### A.5 重新打開寫入

恢復 player-sync / ingest。confirm 一段時間（>1h）後沒問題：

```sql
DROP TABLE public.playback_logs_old;
```

## 路徑 B：dual-write 過渡（10M–100M 列）

過渡期分三階段：

1. **stage 1（前一週）**：建立 `_new` 分區表 + 把歷史資料分批 INSERT 進對應 partition（每晚跑一塊月份，至多用 5 分鐘）。
2. **stage 2**：加一個 AFTER INSERT trigger on `playback_logs`，把每個新 row 同時 INSERT 進 `_new`。等 trigger 跑 1–2 小時無錯。
3. **stage 3（cutover 窗口）**：阻擋寫入 → catch-up 最後一批漏單 → swap names → DROP trigger → 重啟寫入。

stage 1 backfill 範例：

```sql
-- 每次塞一個月
INSERT INTO public.playback_logs_new
     SELECT * FROM public.playback_logs
      WHERE played_at >= '2026-04-01' AND played_at < '2026-05-01';
```

## 路徑 C：直接保留現狀（> 100M 列 或 partition 維護成本過高）

PR-3 已部署的 `purge_playback_logs_batched()` 分批 DELETE 已大幅降低
retention lock storm，可以視為穩態方案。partition 主要好處是 retention
DROP 變 O(1) 而非 O(n) 列數，但維護分區本身有 overhead。資料量到
50–100M / 月再評估升級。

## 回滾

如果 cutover 後發現問題：

```sql
BEGIN;
ALTER TABLE public.playback_logs     RENAME TO playback_logs_failed;
ALTER TABLE public.playback_logs_old RENAME TO playback_logs;
COMMIT;
```

`_failed` 可保留幾天作 forensics 再 DROP。
