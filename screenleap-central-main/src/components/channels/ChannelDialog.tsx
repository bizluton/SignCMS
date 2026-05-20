import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, User as UserIcon, Building2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import type { Channel } from "@/hooks/useChannels";
import { formatUserError } from "@/lib/formatUserError";

const PRESET_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#64748b"];

const NAME_MAX_WIDTH = 12; // English chars; CJK counts as 2
const nameWidth = (s: string) =>
  Array.from(s).reduce((n, ch) => n + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
const truncateByWidth = (s: string, max: number) => {
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 0x7f ? 2 : 1;
    if (w + cw > max) break;
    out += ch;
    w += cw;
  }
  return out;
};

interface TeamLite { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  channel: Channel | null;
  onSaved: () => void;
}

export function ChannelDialog({ open, onOpenChange, orgId, channel, onSaved }: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [bgmVolume, setBgmVolume] = useState(50);
  const [enabled, setEnabled] = useState(true);
  const [teamId, setTeamId] = useState<string>("none");
  const [collabScope, setCollabScope] = useState<"creator" | "team" | "org">("team");
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(channel?.name ?? "");
      setDescription(channel?.description ?? "");
      setColor(channel?.color ?? PRESET_COLORS[0]);
      setBgmVolume(channel?.bgm_volume ?? 50);
      setEnabled(channel?.enabled ?? true);
      setTeamId(channel?.team_id ? String(channel.team_id) : "none");
      setAspect((channel?.aspect === "9:16" ? "9:16" : "16:9") as "16:9" | "9:16");
      const cs = channel?.collab_scope;
      const hasTeam = !!channel?.team_id;
      setCollabScope(
        cs === "creator" || cs === "team" || cs === "org"
          ? cs
          : hasTeam
            ? "team"
            : "org"
      );
      // Load teams for current org
      (async () => {
        const { data } = await supabase
          .from("teams")
          .select("id, name")
          .eq("org_id", orgId)
          .order("name");
        setTeams(data ?? []);
      })();
    }
  }, [open, channel, orgId]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("channelNameRequired"));
      return;
    }
    setSaving(true);
    const teamIdToSave = teamId && teamId !== "none" ? teamId : null;
    const collabToSave = collabScope === "team" && !teamIdToSave ? "org" : collabScope;
    const payload = {
      org_id: orgId,
      name: name.trim(),
      description,
      color,
      bgm_volume: bgmVolume,
      enabled,
      aspect,
      team_id: teamIdToSave,
      collab_scope: collabToSave,
    };
    let error: { message: string } | null;
    if (channel) {
      ({ error } = await supabase.from("channels").update(payload).eq("id", channel.id));
    } else {
      const { error: insErr } = await supabase
        .from("channels")
        .insert({ ...payload, created_by: user?.id });
      error = insErr;
    }
    if (error) {
      setSaving(false);
      toast.error(formatUserError(error, t));
      return;
    }
    setSaving(false);
    toast.success(channel ? t("channelUpdated") : t("channelCreated"));
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{channel ? t("editChannel") : t("newChannel")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>{t("channelName")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(truncateByWidth(e.target.value, NAME_MAX_WIDTH))}
            />
            <p className="text-[11px] text-muted-foreground mt-1 text-right">
              {nameWidth(name)} / {NAME_MAX_WIDTH}
            </p>
          </div>
          <div>
            <Label>{t("channelDescription")}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <Label>螢幕方向</Label>
            <div className="flex gap-2 mt-2">
              {(["16:9", "9:16"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAspect(a)}
                  className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg border-2 text-xs transition-all ${
                    aspect === a ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  <span className={`rounded border ${a === "16:9" ? "w-10 h-6" : "w-6 h-10"} ${aspect === a ? "border-primary bg-primary/20" : "border-muted-foreground/40"}`} />
                  <span className="font-medium">{a === "16:9" ? "橫式" : "直式"}</span>
                  <span className="text-muted-foreground">{a}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("channelTeam")}</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("teamNoTeamLabel")}</SelectItem>
                  {teams.map((tm) => (
                    <SelectItem key={tm.id} value={tm.id}>
                      {tm.name === "Default" ? t("teamNoTeamLabel") : tm.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("channelCollab")}</Label>
              <Select value={collabScope} onValueChange={(v) => setCollabScope(v as "creator" | "team" | "org")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="creator">
                    <span className="inline-flex items-center gap-2"><UserIcon className="w-3.5 h-3.5" />{t("channelCollabCreator")}</span>
                  </SelectItem>
                  <SelectItem value="team" disabled={!teamId || teamId === "none"}>
                    <span className="inline-flex items-center gap-2"><Users className="w-3.5 h-3.5" />{t("channelCollabTeam")}</span>
                  </SelectItem>
                  <SelectItem value="org">
                    <span className="inline-flex items-center gap-2"><Building2 className="w-3.5 h-3.5" />{t("channelCollabOrg")}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>{t("channelColor")}</Label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    color === c ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("channelEnabled")}</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
