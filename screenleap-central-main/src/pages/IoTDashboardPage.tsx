import { useState, useEffect, useCallback, useRef } from "react";
import { Radio, Monitor, RefreshCw, Loader2, Activity, AlertTriangle, Clock, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

interface IotDevice {
  id: string;
  name: string;
  device_type: string;
  status: string;
  screen_id: string;
  org_id: string | null;
  screens?: { id: string; name: string; branch: string; location: string };
}

interface ChartPoint {
  time: string;
  value: number;
}

const TYPE_CONFIG: Record<string, { label: string; icon: string; unit: string; color: string; range: [number, number]; alertThreshold: number }> = {
  air_quality: { label: "空氣品質 (AQI)", icon: "🌬️", unit: "AQI", color: "hsl(var(--primary))", range: [20, 150], alertThreshold: 100 },
  earthquake: { label: "地震震度", icon: "🔔", unit: "gal", color: "hsl(var(--destructive))", range: [0, 5], alertThreshold: 3 },
  fire: { label: "煙霧濃度", icon: "🔥", unit: "%", color: "hsl(210, 70%, 50%)", range: [0, 30], alertThreshold: 15 },
  temperature: { label: "溫度", icon: "🌡️", unit: "°C", color: "hsl(150, 60%, 45%)", range: [18, 35], alertThreshold: 32 },
  noise: { label: "噪音", icon: "🔊", unit: "dB", color: "hsl(270, 50%, 55%)", range: [30, 90], alertThreshold: 70 },
};

type TimeRange = "10m" | "1h" | "6h" | "24h" | "7d";

function getTimeRangeMs(range: TimeRange): number {
  const map: Record<TimeRange, number> = {
    "10m": 10 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };
  return map[range];
}

function formatTime(dateStr: string, range: TimeRange): string {
  const d = new Date(dateStr);
  if (range === "7d" || range === "24h") {
    return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function generateSimValue(type: string): number {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.air_quality;
  const base = (cfg.range[0] + cfg.range[1]) / 2;
  const amp = (cfg.range[1] - cfg.range[0]) / 3;
  return Math.round((base + (Math.random() - 0.5) * amp) * 10) / 10;
}

export default function IoTDashboardPage() {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [screenFilter, setScreenFilter] = useState("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [chartData, setChartData] = useState<Record<string, ChartPoint[]>>({});
  const [currentValues, setCurrentValues] = useState<Record<string, number>>({});
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [simulating, setSimulating] = useState(false);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch devices
  const fetchDevices = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("iot_devices")
      .select("*, screens(id, name, branch, location)")
      .order("created_at", { ascending: true });
    if (activeOrgId) query = query.eq("org_id", activeOrgId);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    else setDevices(data || []);
    setLoading(false);
  }, [activeOrgId]);

  // Fetch historical readings for all devices
  const fetchReadings = useCallback(async (deviceList: IotDevice[]) => {
    if (deviceList.length === 0) {
      setChartData({});
      setCurrentValues({});
      return;
    }
    const since = new Date(Date.now() - getTimeRangeMs(timeRange)).toISOString();
    const deviceIds = deviceList.map((d) => d.id);

    const { data, error } = await supabase
      .from("iot_sensor_readings")
      .select("device_id, value, recorded_at")
      .in("device_id", deviceIds)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .limit(5000);

    if (error) {
      toast.error(error.message);
      return;
    }

    const grouped: Record<string, ChartPoint[]> = {};
    const latest: Record<string, number> = {};

    deviceList.forEach((d) => {
      grouped[d.id] = [];
    });

    (data || []).forEach((r: { device_id: string; value: number; recorded_at: string }) => {
      if (!grouped[r.device_id]) grouped[r.device_id] = [];
      grouped[r.device_id].push({
        time: formatTime(r.recorded_at, timeRange),
        value: Number(r.value),
      });
      latest[r.device_id] = Number(r.value);
    });

    setChartData(grouped);
    setCurrentValues(latest);
    setLastRefresh(new Date());
  }, [timeRange]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);
  useEffect(() => { if (devices.length > 0) fetchReadings(devices); }, [devices, timeRange, fetchReadings]);

  // Realtime subscription for new readings
  useEffect(() => {
    if (devices.length === 0) return;
    const channel = supabase
      .channel(`iot-readings:${user?.id ?? "anon"}:${activeOrgId ?? "noorg"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "iot_sensor_readings" },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new;
          if (!row) return;
          setChartData((prev) => {
            const existing = prev[row.device_id] || [];
            return {
              ...prev,
              [row.device_id]: [...existing, { time: formatTime(row.recorded_at, timeRange), value: Number(row.value) }].slice(-200),
            };
          });
          setCurrentValues((prev) => ({ ...prev, [row.device_id]: Number(row.value) }));
          setLastRefresh(new Date());
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [devices, timeRange, user?.id, activeOrgId]);

  // Simulate data insertion for demo
  const startSimulation = useCallback(() => {
    if (simIntervalRef.current) return;
    setSimulating(true);
    toast.success(language === "en" ? "Simulation started" : "模擬數據產生已啟動");

    simIntervalRef.current = setInterval(async () => {
      const inserts = devices
        .filter((d) => d.status === "online")
        .map((d) => ({
          device_id: d.id,
          screen_id: d.screen_id,
          org_id: d.org_id || null,
          value: generateSimValue(d.device_type),
          unit: (TYPE_CONFIG[d.device_type] || TYPE_CONFIG.air_quality).unit,
        }));

      if (inserts.length > 0) {
        await supabase.from("iot_sensor_readings").insert(inserts);
      }
    }, 5000);
  }, [devices, language]);

  const stopSimulation = useCallback(() => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    setSimulating(false);
    toast.info(language === "en" ? "Simulation stopped" : "模擬數據已停止");
  }, [language]);

  useEffect(() => {
    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, []);

  const screens = Array.from(new Map(devices.filter((d) => d.screens).map((d) => [d.screens!.id, d.screens!])).values());
  const filteredDevices = screenFilter === "all" ? devices : devices.filter((d) => d.screen_id === screenFilter);
  const onlineCount = filteredDevices.filter((d) => d.status === "online").length;
  const alertCount = filteredDevices.filter((d) => {
    const cfg = TYPE_CONFIG[d.device_type];
    const val = currentValues[d.id];
    return cfg && val !== undefined && val >= cfg.alertThreshold;
  }).length;
  const totalReadings = Object.values(chartData).reduce((sum, arr) => sum + arr.length, 0);

  const title = language === "en" ? "IoT Monitoring Dashboard" : language === "ja" ? "IoT モニタリングダッシュボード" : "IoT 即時監控儀表板";
  const subtitle = language === "en" ? "Real-time sensor data from all connected screens" : language === "ja" ? "接続されたスクリーンのリアルタイムセンサーデータ" : "即時顯示各螢幕連接的感測器數據與歷史趨勢";

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Radio className="w-6 h-6 text-primary" />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("tipUpdated")}: {lastRefresh.toLocaleTimeString()}
          </span>
          <Button variant="outline" size="sm" onClick={() => fetchReadings(devices)} className="gap-1.5" title={t("tipRefresh")}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant={simulating ? "destructive" : "default"}
            onClick={simulating ? stopSimulation : startSimulation}
            disabled={devices.filter((d) => d.status === "online").length === 0}
            className="gap-1.5"
          >
            <Activity className="w-3.5 h-3.5" />
            {simulating
              ? (language === "en" ? "Stop Sim" : "停止模擬")
              : (language === "en" ? "Simulate Data" : "模擬數據")}
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 animate-fade-in">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{filteredDevices.length}</p>
              <p className="text-xs text-muted-foreground">{language === "en" ? "Devices" : "裝置"}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{onlineCount}</p>
              <p className="text-xs text-muted-foreground">{language === "en" ? "Online" : "在線"}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <Monitor className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{screens.length}</p>
              <p className="text-xs text-muted-foreground">{language === "en" ? "Screens" : "螢幕"}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
              <Database className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{totalReadings}</p>
              <p className="text-xs text-muted-foreground">{language === "en" ? "Readings" : "筆數據"}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${alertCount > 0 ? "bg-destructive/10" : "bg-success/10"}`}>
              <AlertTriangle className={`w-5 h-5 ${alertCount > 0 ? "text-destructive" : "text-success"}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{alertCount}</p>
              <p className="text-xs text-muted-foreground">{language === "en" ? "Alerts" : "警報"}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={screenFilter} onValueChange={setScreenFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{language === "en" ? "All Screens" : "所有螢幕"}</SelectItem>
            {screens.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)} className="ml-auto">
          <TabsList>
            <TabsTrigger value="10m" className="text-xs px-3">10{language === "en" ? "m" : "分"}</TabsTrigger>
            <TabsTrigger value="1h" className="text-xs px-3">1{language === "en" ? "h" : "時"}</TabsTrigger>
            <TabsTrigger value="6h" className="text-xs px-3">6{language === "en" ? "h" : "時"}</TabsTrigger>
            <TabsTrigger value="24h" className="text-xs px-3">24{language === "en" ? "h" : "時"}</TabsTrigger>
            <TabsTrigger value="7d" className="text-xs px-3">7{language === "en" ? "d" : "天"}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Device cards */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filteredDevices.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Radio className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>{language === "en" ? "No IoT devices found" : "尚未有 IoT 裝置連接"}</p>
          <p className="text-xs mt-1">{language === "en" ? "Add devices from the Screens page" : "請至螢幕管理頁面新增 IoT 裝置"}</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredDevices.map((device) => {
            const cfg = TYPE_CONFIG[device.device_type] || TYPE_CONFIG.air_quality;
            const readings = chartData[device.id] || [];
            const currentVal = currentValues[device.id];
            const hasData = readings.length > 0;
            const isAlert = currentVal !== undefined && currentVal >= cfg.alertThreshold;

            // Compute stats
            const values = readings.map((r) => r.value);
            const avg = values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
            const min = values.length > 0 ? Math.min(...values) : null;
            const max = values.length > 0 ? Math.max(...values) : null;

            return (
              <Card key={device.id} className={`p-5 transition-all ${isAlert ? "ring-2 ring-destructive/50" : ""}`}>
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{cfg.icon}</span>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{device.name}</h3>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Monitor className="w-3 h-3" />
                        {device.screens?.name || "Unknown"}
                        {device.screens?.location && ` · ${device.screens.location}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-2xl font-bold ${isAlert ? "text-destructive" : "text-foreground"}`}>
                      {currentVal !== undefined ? currentVal : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{cfg.unit}</p>
                  </div>
                </div>

                {/* Status row */}
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant={device.status === "online" ? "default" : "secondary"} className="text-[10px]">
                    <span className={`w-1.5 h-1.5 rounded-full mr-1 ${device.status === "online" ? "bg-success" : "bg-destructive"}`} />
                    {device.status === "online" ? (language === "en" ? "Online" : "連線中") : (language === "en" ? "Offline" : "離線")}
                  </Badge>
                  {isAlert && (
                    <Badge variant="destructive" className="text-[10px] gap-1 animate-pulse">
                      <AlertTriangle className="w-3 h-3" />
                      {language === "en" ? "Alert" : "超標"}
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {readings.length} {language === "en" ? "readings" : "筆"}
                  </span>
                </div>

                {/* Stats */}
                {hasData && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="text-center p-1.5 bg-muted/50 rounded">
                      <p className="text-[10px] text-muted-foreground">{language === "en" ? "Min" : "最低"}</p>
                      <p className="text-xs font-semibold text-foreground">{min} {cfg.unit}</p>
                    </div>
                    <div className="text-center p-1.5 bg-muted/50 rounded">
                      <p className="text-[10px] text-muted-foreground">{language === "en" ? "Avg" : "平均"}</p>
                      <p className="text-xs font-semibold text-foreground">{avg} {cfg.unit}</p>
                    </div>
                    <div className="text-center p-1.5 bg-muted/50 rounded">
                      <p className="text-[10px] text-muted-foreground">{language === "en" ? "Max" : "最高"}</p>
                      <p className="text-xs font-semibold text-foreground">{max} {cfg.unit}</p>
                    </div>
                  </div>
                )}

                {/* Chart */}
                <div className="h-[140px] w-full">
                  {!hasData ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                      <Clock className="w-6 h-6 mb-1 opacity-30" />
                      <p className="text-xs">{language === "en" ? "No data in this time range" : "此時間範圍內無數據"}</p>
                      <p className="text-[10px]">{language === "en" ? "Click 'Simulate Data' to generate" : "點擊「模擬數據」產生測試資料"}</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={readings} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`grad-${device.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={cfg.color} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={cfg.color} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["auto", "auto"]} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                          formatter={(value: number) => [`${value} ${cfg.unit}`, cfg.label]}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke={cfg.color}
                          strokeWidth={2}
                          fill={`url(#grad-${device.id})`}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 2 }}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
