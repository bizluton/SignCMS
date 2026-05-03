import { useEffect, useState } from "react";
import { Globe, Code2, Youtube, CloudSun } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

function WebpageWidgetPreview({ url, bg }: { url: string; bg: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
      <Globe className="w-6 h-6 opacity-40" />
    </div>
  );
  return (
    <iframe
      src={url}
      className="w-full h-full border-0 pointer-events-none"
      sandbox="allow-scripts"
      onError={() => setFailed(true)}
    />
  );
}

export type WidgetSubType = "date" | "clock" | "webpage" | "marquee" | "qrcode" | "countdown" | "youtube" | "weather";
export type WidgetAnimation = "none" | "fadeIn" | "slideUp" | "bounce" | "zoomIn" | "flipIn";

export interface WidgetConfig {
  widgetType: WidgetSubType;
  url?: string;
  text?: string;
  speed?: "slow" | "normal" | "fast";
  format?: "12" | "24";
  clockStyle?: "digital" | "analog";
  showDate?: boolean;
  timezone?: string;
  bgColor?: string;
  textColor?: string;
  qrcodeContent?: string;
  targetDate?: string;
  countdownTitle?: string;
  youtubeUrl?: string;
  city?: string;
  fontSize?: "small" | "medium" | "large" | "xlarge";
  qrcodeSize?: number;
  animation?: WidgetAnimation;
  paramsSchema?: unknown[];
  params?: Record<string, unknown>;
  _catalogType?: string;
}

const ZONE_FS: Record<string, Record<string, string>> = {
  small:  { time: "text-base",  title: "text-xs",     countdown: "text-base", marquee: "text-xs" },
  medium: { time: "text-2xl",   title: "text-[10px]", countdown: "text-lg",   marquee: "text-sm" },
  large:  { time: "text-3xl",   title: "text-sm",     countdown: "text-2xl",  marquee: "text-lg" },
  xlarge: { time: "text-4xl",   title: "text-base",   countdown: "text-3xl",  marquee: "text-xl" },
};

export function WidgetPreviewCard({ config }: { config: WidgetConfig }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (config.widgetType === "clock" || config.widgetType === "date" || config.widgetType === "countdown") {
      const timer = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(timer);
    }
  }, [config.widgetType]);

  const bg = config.bgColor || "#1a1a2e";
  const fg = config.textColor || "#ffffff";
  const zfs = ZONE_FS[config.fontSize || "medium"] || ZONE_FS.medium;

  if (config.widgetType === "clock") {
    const tz = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (config.clockStyle === "analog") {
      const hParts = now.toLocaleString("en-US", { hour: "numeric", minute: "numeric", second: "numeric", hour12: false, timeZone: tz }).split(":");
      const h = parseInt(hParts[0]), m = parseInt(hParts[1]), s = parseInt(hParts[2]);
      const hDeg = (h % 12) * 30 + m * 0.5, mDeg = m * 6, sDeg = s * 6;
      return (
        <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
          <svg viewBox="0 0 200 200" className="w-[70%] max-w-[160px]">
            <circle cx="100" cy="100" r="96" fill="none" stroke={fg} strokeWidth="2" opacity="0.15" />
            {[...Array(12)].map((_, i) => {
              const num = i === 0 ? 12 : i;
              const angle = (i * 30 - 90) * Math.PI / 180;
              return <text key={i} x={100 + 78 * Math.cos(angle)} y={100 + 78 * Math.sin(angle)} textAnchor="middle" dominantBaseline="central" fill={fg} fontSize="14" fontWeight="600" opacity="0.8">{num}</text>;
            })}
            <polygon points={`${100 + 45 * Math.cos((hDeg - 90) * Math.PI / 180)},${100 + 45 * Math.sin((hDeg - 90) * Math.PI / 180)} ${100 + 5 * Math.cos(hDeg * Math.PI / 180)},${100 + 5 * Math.sin(hDeg * Math.PI / 180)} ${100 - 10 * Math.cos((hDeg - 90) * Math.PI / 180)},${100 - 10 * Math.sin((hDeg - 90) * Math.PI / 180)} ${100 - 5 * Math.cos(hDeg * Math.PI / 180)},${100 - 5 * Math.sin(hDeg * Math.PI / 180)}`} fill={fg} opacity="0.9" />
            <polygon points={`${100 + 65 * Math.cos((mDeg - 90) * Math.PI / 180)},${100 + 65 * Math.sin((mDeg - 90) * Math.PI / 180)} ${100 + 4 * Math.cos(mDeg * Math.PI / 180)},${100 + 4 * Math.sin(mDeg * Math.PI / 180)} ${100 - 12 * Math.cos((mDeg - 90) * Math.PI / 180)},${100 - 12 * Math.sin((mDeg - 90) * Math.PI / 180)} ${100 - 4 * Math.cos(mDeg * Math.PI / 180)},${100 - 4 * Math.sin(mDeg * Math.PI / 180)}`} fill={fg} opacity="0.85" />
            <line x1={100 - 18 * Math.cos((sDeg - 90) * Math.PI / 180)} y1={100 - 18 * Math.sin((sDeg - 90) * Math.PI / 180)} x2={100 + 72 * Math.cos((sDeg - 90) * Math.PI / 180)} y2={100 + 72 * Math.sin((sDeg - 90) * Math.PI / 180)} stroke="hsl(0 70% 55%)" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="100" cy="100" r="5" fill={fg} />
          </svg>
        </div>
      );
    }
    const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: config.format === "12", timeZone: tz };
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <span className={`${zfs.time} font-mono font-bold tracking-wider`}>{now.toLocaleTimeString("en-US", opts)}</span>
        {config.showDate && <span className="text-[10px] opacity-60">{now.toLocaleDateString("zh-TW", { month: "short", day: "numeric", timeZone: tz })}</span>}
      </div>
    );
  }

  if (config.widgetType === "date") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <span className="text-sm font-medium opacity-70">{now.toLocaleDateString("zh-TW", { weekday: "long" })}</span>
        <span className="text-xl font-bold">{now.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" })}</span>
      </div>
    );
  }

  if (config.widgetType === "marquee" && config.text) {
    return (
      <div className="w-full h-full flex items-center overflow-hidden" style={{ background: bg, color: fg }}>
        <div className={`animate-marquee whitespace-nowrap ${zfs.marquee} font-medium`}>{config.text}</div>
      </div>
    );
  }

  if (config.widgetType === "webpage") {
    if (config.url) return <WebpageWidgetPreview url={config.url} bg={bg} />;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <Globe className="w-6 h-6 opacity-50" />
        <span className="text-[10px] opacity-60">URL</span>
      </div>
    );
  }

  if (config.widgetType === "qrcode") {
    const qrSize = config.qrcodeSize ? Math.min(config.qrcodeSize, 120) : 80;
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: bg }}>
        <QRCodeSVG value={config.qrcodeContent || "https://example.com"} size={qrSize} bgColor={bg} fgColor={fg} level="M" />
      </div>
    );
  }

  if (config.widgetType === "countdown") {
    const target = config.targetDate ? new Date(config.targetDate).getTime() : Date.now() + 86400000;
    const diff = Math.max(0, target - now.getTime());
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        {config.countdownTitle && <span className={`${zfs.title} font-bold opacity-70`}>{config.countdownTitle}</span>}
        <div className="flex gap-2">
          {[days, hours, mins, secs].map((v, i) => (
            <span key={i} className={`${zfs.countdown} font-mono font-bold`}>{String(v).padStart(2, "0")}</span>
          ))}
        </div>
      </div>
    );
  }

  if (config.widgetType === "youtube") {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: bg, color: fg }}>
        <Youtube className="w-8 h-8 opacity-50" />
      </div>
    );
  }

  if (config.widgetType === "weather") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: bg, color: fg }}>
        <CloudSun className="w-8 h-8 opacity-50" />
        <span className="text-[10px] font-medium">{config.city || "City"}</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: bg, color: fg }}>
      <Code2 className="w-6 h-6 opacity-50" />
    </div>
  );
}
