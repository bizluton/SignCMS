-- ── Weather cache ──────────────────────────────────────────────────────────
-- Stores upstream weather API responses so every client reads from one source.
-- Edge Function refreshes entries older than 30 minutes; expired rows kept
-- as stale fallback if upstream APIs are temporarily unreachable.

CREATE TABLE IF NOT EXISTS public.weather_cache (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cache_key   text        UNIQUE NOT NULL,   -- e.g. "cwa:臺北市:信義區"
  location    text        NOT NULL,
  lat         numeric(9,6),
  lon         numeric(9,6),
  data        jsonb       NOT NULL,          -- { temp, wx, pop, humidity, wind }
  source      text        NOT NULL,          -- 'cwa' | 'open-meteo' | 'owm' | ...
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS weather_cache_key_idx     ON public.weather_cache (cache_key);
CREATE INDEX IF NOT EXISTS weather_cache_expires_idx ON public.weather_cache (expires_at);

-- Public read; writes only through service-role (Edge Function)
ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weather_cache_public_read" ON public.weather_cache;
CREATE POLICY "weather_cache_public_read"
  ON public.weather_cache FOR SELECT USING (true);
