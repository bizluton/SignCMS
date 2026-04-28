import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Wifi, WifiOff, RefreshCw, Tv, Monitor, MapPin, Layers, Cable,
  Cpu, Hash, Play, Pencil, BellOff, CheckCircle2, Loader2, Plug,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ScreenDetailScreen {
  id: string;
  name: string;
  branch?: string;
  location?: string;
  resolution?: string;
  online: boolean;
  org_id?: string | null;
  serial_number?: string;
  ip_address?: string;
  connection_type?: string;
  firmware_version?: string;
  updated_at?: string;
}

interface Props {
  screen: ScreenDetailScreen | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectedPlayer?: string;
  onEdit?: (screen: ScreenDetailScreen) => void;
  onChanged?: () => void;
}

export function ScreenDetailDrawer({
  screen, open, onOpenChange, connectedPlayer, onEdit, onChanged,
}: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rechecking, setRechecking] = useState(false);
  const [acking, setAcking] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [activeAlertId, setActiveAlertId] = useState<string | null>(null);

  // Look up an active screen_alert for this screen (so we can acknowledge it)
  useEffect(() => {
    if (!screen || !open) {
      setActiveAlertId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("screen_alerts")
        .select("id")
        .eq("screen_id", screen.id)
        .eq("status", "active")
        .maybeSingle();
      if (!cancelled) setActiveAlertId(data?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [screen, open]);

  if (!screen) return null;

  const lastHeartbeat = screen.updated_at
    ? new Date(screen.updated_at).toLocaleString()
    : t("screenStatusNeverSeen");

  const handleRecheck = async () => {
    setRechecking(true);
    // Re-fetch the latest screen row to refresh status
    const { data, error } = await (supabase as any)
      .from("screens")
      .select("online, updated_at")
      .eq("id", screen.id)
      .maybeSingle();
    setRechecking(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      `${t("screenDetailRecheckOk")} · ${data?.online ? t("online") : t("offline")}`
    );
    onChanged?.();
  };

  const handleAcknowledge = async () => {
    if (!activeAlertId) {
      toast.info(t("screenDetailNoActiveAlert"));
      return;
    }
    if (!user) return;
    setAcking(true);
    const { error } = await (supabase as any)
      .from("screen_alerts")
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: user.id,
      })
      .eq("id", activeAlertId);
    setAcking(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("screenDetailAcknowledged"));
    setActiveAlertId(null);
    onChanged?.();
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("screen-reconnect", {
        body: { screen_id: screen.id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Unexpected response");
      toast.success(t("screenDetailReconnectOk"));
      setActiveAlertId(null);
      onChanged?.();
    } catch (err: any) {
      toast.error(`${t("screenDetailReconnectFailed")}: ${err?.message ?? err}`);
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-2">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              screen.online ? "bg-success/10" : "bg-destructive/10"
            }`}>
              <Monitor className={`w-6 h-6 ${
                screen.online ? "text-success" : "text-destructive"
              }`} />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="truncate">{screen.name}</SheetTitle>
              <SheetDescription className="flex items-center gap-2 mt-1">
                <Badge
                  variant={screen.online ? "default" : "destructive"}
                  className="gap-1.5"
                >
                  <span className="relative flex w-2 h-2">
                    {screen.online && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-success-foreground/70 opacity-75 animate-ping" />
                    )}
                    <span className={`relative inline-flex w-2 h-2 rounded-full ${
                      screen.online ? "bg-success-foreground" : "bg-destructive-foreground"
                    }`} />
                  </span>
                  {screen.online ? t("online") : t("offline")}
                </Badge>
                {activeAlertId && (
                  <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
                    {t("dashOfflineAlertsTitle")}
                  </Badge>
                )}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Overview */}
        <section className="mt-6 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("screenDetailOverview")}
          </h3>
          <DetailRow icon={Wifi} label={t("screenStatusIp")} mono value={screen.ip_address || "—"} />
          <DetailRow icon={RefreshCw} label={t("screenStatusHeartbeat")} value={lastHeartbeat} />
          <DetailRow icon={Tv} label={t("screenStatusPlayer")} value={connectedPlayer || t("screenStatusNoPlayer")} />
          <Separator />
          <DetailRow icon={Layers} label={t("screenDetailGroup")} value={screen.branch || "—"} />
          {screen.location && <DetailRow icon={MapPin} label={t("screenDetailLocation")} value={screen.location} />}
          <DetailRow icon={Monitor} label={t("screenDetailResolution")} value={screen.resolution || "—"} />
          <DetailRow icon={Cpu} label={t("screenDetailFirmware")} mono value={screen.firmware_version || "—"} />
          <DetailRow icon={Hash} label={t("screenDetailSerial")} mono value={screen.serial_number || "—"} />
          {screen.connection_type && (
            <DetailRow
              icon={screen.connection_type === "wired" ? Cable : Wifi}
              label={t("screenDetailConnection")}
              value={screen.connection_type === "wired" ? t("tipWired") : t("tipWireless")}
            />
          )}
        </section>

        {/* Quick actions */}
        <section className="mt-6 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("screenDetailQuickActions")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="justify-start gap-2" onClick={handleRecheck} disabled={rechecking}>
              {rechecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {rechecking ? t("screenDetailRechecking") : t("screenDetailRecheck")}
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={handleReconnect}
              disabled={reconnecting}
            >
              {reconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {reconnecting ? t("screenDetailReconnecting") : t("screenDetailReconnect")}
            </Button>
            <Button
              variant={activeAlertId ? "default" : "outline"}
              className="justify-start gap-2"
              onClick={handleAcknowledge}
              disabled={acking || !activeAlertId}
            >
              {acking ? <Loader2 className="w-4 h-4 animate-spin" /> : activeAlertId ? <BellOff className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {activeAlertId ? t("screenDetailAcknowledge") : t("screenDetailNoActiveAlert")}
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => { onOpenChange(false); navigate(`/player/${screen.id}`); }}
            >
              <Play className="w-4 h-4" />
              {t("screenDetailOpenPlayer")}
            </Button>
            {onEdit && (
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={() => { onOpenChange(false); onEdit(screen); }}
              >
                <Pencil className="w-4 h-4" />
                {t("screenDetailEdit")}
              </Button>
            )}
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  icon: Icon, label, value, mono,
}: { icon: any; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <span className={`flex-1 min-w-0 truncate text-foreground ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}