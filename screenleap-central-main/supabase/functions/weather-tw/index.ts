// Weather-TW proxy — fetches CWA OpenData API server-side and returns JSON
// No JWT required (verify_jwt = false in config.toml) so the public widget can call it.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const CWA_KEY = "CWA-DDEBA554-096E-424E-8529-A04E77AF6FD1";

const COUNTY_MAP: Record<string, string> = {
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const locationName = url.searchParams.get("locationName") || "臺北市";
  const regionName   = url.searchParams.get("regionName")   || "信義區";

  const datasetId = COUNTY_MAP[locationName];
  if (!datasetId) return json({ error: `Unknown county: ${locationName}` }, 400);

  const apiUrl =
    `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${datasetId}` +
    `?Authorization=${CWA_KEY}`;

  try {
    const res  = await fetch(apiUrl);
    const data = await res.json();

    const locationList: Array<{
      LocationName: string;
      WeatherElement: Array<{
        ElementName: string;
        Time: Array<{ ElementValue: Array<Record<string, string>> }>;
      }>;
    }> = data?.records?.Locations?.[0]?.Location ?? [];

    if (!locationList.length) return json({ error: "No location data" }, 502);

    const loc =
      locationList.find((l) => l.LocationName === regionName) ?? locationList[0];

    let temp = "--", wx = "--", pop = "--";
    for (const we of loc.WeatherElement ?? []) {
      const ev = we.Time?.[0]?.ElementValue?.[0];
      if (!ev) continue;
      switch (we.ElementName) {
        case "溫度":          temp = ev.Temperature                ?? "--"; break;
        case "天氣現象":      wx   = ev.Weather                    ?? "--"; break;
        case "3小時降雨機率": pop  = ev.ProbabilityOfPrecipitation ?? "--"; break;
      }
    }

    return json({ location: loc.LocationName, temp, wx, pop });
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
});
