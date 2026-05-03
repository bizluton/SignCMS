/**
 * Unified Weather API — SignCMS weather server
 *
 * Routing:
 *   Taiwan     →  ?locationName=臺北市&regionName=信義區   → CWA OpenData + Open-Meteo UV/AQ
 *   Lat / Lon  →  ?lat=35.68&lon=139.76                   → Open-Meteo
 *   City name  →  ?city=Tokyo&country=JP                   → geocode → Open-Meteo
 *
 * All responses are cached in public.weather_cache (30-min TTL).
 * Stale cache is returned when upstream APIs are unreachable.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Config ────────────────────────────────────────────────────────────────────
const CACHE_TTL_MIN = 30;

const CWA_KEY = Deno.env.get("CWA_API_KEY") ||
  "CWA-DDEBA554-096E-424E-8529-A04E77AF6FD1";

// ── Taiwan county → CWA dataset map ──────────────────────────────────────────
const CWA_MAP: Record<string, string> = {
  "臺北市": "F-D0047-061", "台北市": "F-D0047-061",
  "新北市": "F-D0047-069",
  "桃園市": "F-D0047-005",
  "臺中市": "F-D0047-073", "台中市": "F-D0047-073",
  "臺南市": "F-D0047-077", "台南市": "F-D0047-077",
  "高雄市": "F-D0047-065",
  "基隆市": "F-D0047-049",
  "新竹縣": "F-D0047-009",
  "新竹市": "F-D0047-053",
  "苗栗縣": "F-D0047-013",
  "彰化縣": "F-D0047-017",
  "南投縣": "F-D0047-021",
  "雲林縣": "F-D0047-025",
  "嘉義縣": "F-D0047-029",
  "嘉義市": "F-D0047-057",
  "屏東縣": "F-D0047-033",
  "宜蘭縣": "F-D0047-001",
  "花蓮縣": "F-D0047-041",
  "臺東縣": "F-D0047-037", "台東縣": "F-D0047-037",
  "澎湖縣": "F-D0047-045",
  "金門縣": "F-D0047-085",
  "連江縣": "F-D0047-081",
};

// ── Taiwan county → lat/lon (for Open-Meteo UV/AQ supplement) ────────────────
const CWA_COORDS: Record<string, { lat: number; lon: number }> = {
  "臺北市": { lat: 25.038, lon: 121.564 }, "台北市": { lat: 25.038, lon: 121.564 },
  "新北市": { lat: 25.017, lon: 121.463 },
  "桃園市": { lat: 24.994, lon: 121.301 },
  "臺中市": { lat: 24.148, lon: 120.674 }, "台中市": { lat: 24.148, lon: 120.674 },
  "臺南市": { lat: 23.000, lon: 120.227 }, "台南市": { lat: 23.000, lon: 120.227 },
  "高雄市": { lat: 22.627, lon: 120.301 },
  "基隆市": { lat: 25.128, lon: 121.739 },
  "新竹縣": { lat: 24.839, lon: 121.018 },
  "新竹市": { lat: 24.814, lon: 120.968 },
  "苗栗縣": { lat: 24.560, lon: 120.821 },
  "彰化縣": { lat: 24.052, lon: 120.516 },
  "南投縣": { lat: 23.961, lon: 120.972 },
  "雲林縣": { lat: 23.709, lon: 120.431 },
  "嘉義縣": { lat: 23.452, lon: 120.255 },
  "嘉義市": { lat: 23.480, lon: 120.449 },
  "屏東縣": { lat: 22.552, lon: 120.549 },
  "宜蘭縣": { lat: 24.702, lon: 121.738 },
  "花蓮縣": { lat: 23.987, lon: 121.602 },
  "臺東縣": { lat: 22.758, lon: 121.144 }, "台東縣": { lat: 22.758, lon: 121.144 },
  "澎湖縣": { lat: 23.571, lon: 119.579 },
  "金門縣": { lat: 24.449, lon: 118.377 },
  "連江縣": { lat: 26.157, lon: 119.940 },
};

// ── WMO weather code → description (zh) ──────────────────────────────────────
const WMO: Record<number, string> = {
  0: "晴天",
  1: "大致晴朗", 2: "局部多雲", 3: "陰天",
  45: "霧", 48: "霧淞",
  51: "毛毛雨", 53: "中等毛毛雨", 55: "大毛毛雨",
  56: "凍毛毛雨", 57: "強凍毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  66: "凍雨", 67: "強凍雨",
  71: "小雪", 73: "中雪", 75: "大雪", 77: "冰晶",
  80: "短暫陣雨", 81: "中等陣雨", 82: "強陣雨",
  85: "陣雪", 86: "強陣雪",
  95: "雷雨", 96: "雷雨夾冰雹", 99: "強雷雨夾冰雹",
};

// ── Supabase client ───────────────────────────────────────────────────────────
function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
interface CacheRow {
  data: Record<string, string>;
  source: string;
  fetched_at: string;
  expires_at: string;
}

async function getCached(key: string): Promise<CacheRow | null> {
  const { data } = await sb()
    .from("weather_cache")
    .select("data, source, fetched_at, expires_at")
    .eq("cache_key", key)
    .single();
  return (data as CacheRow) ?? null;
}

async function upsertCache(
  key: string,
  location: string,
  lat: number | null,
  lon: number | null,
  data: Record<string, string>,
  source: string,
) {
  const now = new Date();
  const expires = new Date(now.getTime() + CACHE_TTL_MIN * 60_000);
  await sb().from("weather_cache").upsert(
    { cache_key: key, location, lat, lon, data, source,
      fetched_at: now.toISOString(), expires_at: expires.toISOString() },
    { onConflict: "cache_key" },
  );
}

// ── UV index + Air Quality (Open-Meteo, free) ─────────────────────────────────
async function fetchUVandAQ(
  lat: number,
  lon: number,
): Promise<{ uv: string; pm25: string; aqi: string }> {
  try {
    const [fRes, aqRes] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}&current=uv_index&timezone=auto`,
      ),
      fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality` +
        `?latitude=${lat}&longitude=${lon}&current=pm2_5,european_aqi&timezone=auto`,
      ),
    ]);
    const [f, aq] = await Promise.all([fRes.json(), aqRes.json()]);
    return {
      uv:   String(Math.round(f?.current?.uv_index   ?? 0)),
      pm25: String(Math.round(aq?.current?.pm2_5      ?? 0)),
      aqi:  String(Math.round(aq?.current?.european_aqi ?? 0)),
    };
  } catch {
    return { uv: "--", pm25: "--", aqi: "--" };
  }
}

// ── Data sources ──────────────────────────────────────────────────────────────

// Taiwan: CWA OpenData + Open-Meteo UV/AQ
async function fetchCWA(
  locationName: string,
  regionName: string,
): Promise<Record<string, string>> {
  const datasetId = CWA_MAP[locationName];
  if (!datasetId) throw new Error(`Unknown county: ${locationName}`);

  const coords = CWA_COORDS[locationName];

  const [cwaRes, uvAq] = await Promise.all([
    fetch(
      `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${datasetId}` +
      `?Authorization=${CWA_KEY}`,
    ),
    coords ? fetchUVandAQ(coords.lat, coords.lon)
           : Promise.resolve({ uv: "--", pm25: "--", aqi: "--" }),
  ]);

  const payload = await cwaRes.json();
  const locationList = payload?.records?.Locations?.[0]?.Location ?? [];
  if (!locationList.length) throw new Error("CWA: no location data");

  const loc =
    locationList.find((l: { LocationName: string }) =>
      l.LocationName === regionName
    ) ?? locationList[0];

  let temp = "--", wx = "--", pop = "--", humidity = "--", wind = "--";
  for (const we of loc.WeatherElement ?? []) {
    const ev = we.Time?.[0]?.ElementValue?.[0];
    if (!ev) continue;
    switch (we.ElementName) {
      case "溫度":          temp     = ev.Temperature                ?? "--"; break;
      case "天氣現象":      wx       = ev.Weather                    ?? "--"; break;
      case "3小時降雨機率": pop      = ev.ProbabilityOfPrecipitation ?? "--"; break;
      case "相對濕度":      humidity = ev.RelativeHumidity           ?? "--"; break;
      case "風速":          wind     = ev.WindSpeed                  ?? "--"; break;
    }
  }
  return { location: loc.LocationName, temp, wx, pop, humidity, wind, ...uvAq };
}

// Global: Open-Meteo forecast + UV + AQ
async function fetchOpenMeteo(
  lat: number,
  lon: number,
  locationName?: string,
): Promise<Record<string, string>> {
  const [fRes, uvAq] = await Promise.all([
    fetch(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,precipitation_probability,` +
      `relative_humidity_2m,wind_speed_10m` +
      `&timezone=auto`,
    ),
    fetchUVandAQ(lat, lon),
  ]);
  const payload = await fRes.json();
  const c = payload?.current;
  if (!c) throw new Error("Open-Meteo: no current data");

  return {
    location: locationName ?? `${lat.toFixed(2)},${lon.toFixed(2)}`,
    temp:     String(Math.round(c.temperature_2m ?? 0)),
    wx:       WMO[c.weather_code] ?? `(${c.weather_code})`,
    pop:      String(c.precipitation_probability ?? "--"),
    humidity: String(c.relative_humidity_2m ?? "--"),
    wind:     String((c.wind_speed_10m ?? 0).toFixed(1)),
    ...uvAq,
  };
}

// Geocoding: Open-Meteo geocoding API (free)
// Note: the API only searches by city name; country code is used only for
// filtering among results after the search, not as part of the name query.
async function geocode(
  city: string,
  country?: string,
  lang = "zh",
): Promise<{ lat: number; lon: number; name: string } | null> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(city)}&count=10&language=${lang}&format=json`,
  );
  const payload = await res.json();
  const results: Array<{ latitude: number; longitude: number; name: string; country_code: string }> =
    payload?.results ?? [];
  if (!results.length) return null;

  // Prefer a result whose country_code matches (case-insensitive), fall back to first result
  const match = country
    ? (results.find((r) => r.country_code?.toUpperCase() === country.toUpperCase()) ?? results[0])
    : results[0];

  return { lat: match.latitude, lon: match.longitude, name: match.name };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const p = new URL(req.url).searchParams;
  const locationName = p.get("locationName") ?? "";
  const regionName   = p.get("regionName")   ?? "";
  const latStr       = p.get("lat")          ?? "";
  const lonStr       = p.get("lon")          ?? "";
  const city         = p.get("city")         ?? "";
  const country      = p.get("country")      ?? "";
  const lang         = p.get("lang")         || "zh";

  let cacheKey = "";
  let weatherData: Record<string, string>;
  let source = "";
  let lat: number | null = null;
  let lon: number | null = null;

  if (locationName && CWA_MAP[locationName]) {
    cacheKey = `cwa:${locationName}:${regionName}`;
    source   = "cwa";
  } else if (latStr && lonStr) {
    lat = parseFloat(latStr);
    lon = parseFloat(lonStr);
    cacheKey = `latlon:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    source   = "open-meteo";
  } else if (city) {
    cacheKey = `city:${city.toLowerCase()}:${country.toLowerCase()}:${lang}`;
    source   = "open-meteo";
  } else {
    return json(
      { error: "Provide locationName+regionName, lat+lon, or city[+country]" },
      400,
    );
  }

  const cached = await getCached(cacheKey);
  const now = Date.now();

  if (cached && new Date(cached.expires_at).getTime() > now) {
    return json({ ...cached.data, source: cached.source, cached_at: cached.fetched_at, cache: "hit" });
  }

  try {
    if (source === "cwa") {
      weatherData = await fetchCWA(locationName, regionName);

    } else if (latStr && lonStr) {
      weatherData = await fetchOpenMeteo(lat!, lon!);

    } else {
      const geo = await geocode(city, country || undefined, lang);
      if (!geo) {
        if (cached) return json({ ...cached.data, source: cached.source, cached_at: cached.fetched_at, cache: "stale" });
        return json({ error: `Cannot geocode city: ${city}` }, 404);
      }
      lat = geo.lat;
      lon = geo.lon;
      weatherData = await fetchOpenMeteo(lat, lon, geo.name);
    }

    await upsertCache(cacheKey, weatherData.location, lat, lon, weatherData, source);
    return json({ ...weatherData, source, cached_at: new Date().toISOString(), cache: "miss" });

  } catch (err) {
    if (cached) {
      return json({ ...cached.data, source: cached.source, cached_at: cached.fetched_at, cache: "stale" });
    }
    return json({ error: String(err) }, 502);
  }
});
