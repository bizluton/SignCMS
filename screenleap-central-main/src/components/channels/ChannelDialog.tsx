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
import { Badge } from "@/components/ui/badge";
import { X, Plus, Star, GripVertical, ArrowUp, ArrowDown, Users, User as UserIcon, Building2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import type { Channel } from "@/hooks/useChannels";

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

interface DesignProjectLite { id: string; name: string }
interface TeamLite { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  channel: Channel | null;
  designProjects: DesignProjectLite[];
  onSaved: () => void;
}

export function ChannelDialog({ open, onOpenChange, orgId, channel, designProjects, onSaved }: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [bgmVolume, setBgmVolume] = useState(50);
  const [enabled, setEnabled] = useState(true);
  const [defaultProjectId, setDefaultProjectId] = useState<string>("");
  const [allowedProjectIds, setAllowedProjectIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState<string>("none");
  const [collabScope, setCollabScope] = useState<"creator" | "team" | "org">("team");
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setName(channel?.name ?? "");
      setDescription(channel?.description ?? "");
      setColor(channel?.color ?? PRESET_COLORS[0]);
      setBgmVolume(channel?.bgm_volume ?? 50);
      setEnabled(channel?.enabled ?? true);
      setDefaultProjectId(channel?.default_design_project_id ?? "");
      setTeamId(channel?.team_id ? String(channel.team_id) : "none");
      const cs = channel?.collab_scope;
      const hasTeam = !!channel?.team_id;
      setCollabScope(
        cs === "creator" || cs === "team" || cs === "org"
          ? cs
          : hasTeam
            ? "team"
            : "org"
      );
      setPickerKey((k) => k + 1);
      // load allowed projects
      if (channel?.id) {
        (async () => {
          const { data } = await supabase
            .from("channel_allowed_projects")
            .select("design_project_id")
            .eq("channel_id", channel.id)
            .order("sort_order", { ascending: true });
          setAllowedProjectIds((data ?? []).map((r) => r.design_project_id));
        })();
      } else {
        setAllowedProjectIds([]);
      }
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

  const addAllowed = (id: string) => {
    if (!id || allowedProjectIds.includes(id)) return;
    setAllowedProjectIds((p) => [...p, id]);
    if (!defaultProjectId) setDefaultProjectId(id);
    setPickerKey((k) => k + 1);
  };

  const removeAllowed = (id: string) => {
    setAllowedProjectIds((p) => p.filter((x) => x !== id));
    if (defaultProjectId === id) setDefaultProjectId("");
  };

  const moveAllowed = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setAllowedProjectIds((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const projectName = (id: string) =>
    designProjects.find((p) => p.id === id)?.name ?? "—";

  const availableToAdd = designProjects.filter((p) => !allowedProjectIds.includes(p.id));

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
      default_design_project_id: defaultProjectId || null,
      team_id: teamIdToSave,
      collab_scope: collabToSave,
    };
    let error: { message: string } | null;
    let channelId = channel?.id;
    if (channel) {
      ({ error } = await supabase.from("channels").update(payload).eq("id", channel.id));
    } else {
      const { data, error: insErr } = await supabase
        .from("channels")
        .insert({ ...payload, created_by: user?.id })
        .select("id")
        .single();
      error = insErr;
      channelId = data?.id;
    }
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }
    // sync allowed projects (delete + reinsert)
    if (channelId) {
      const { error: delErr } = await supabase
        .from("channel_allowed_projects")
        .delete()
        .eq("channel_id", channelId);
      if (delErr) {
        toast.error(`Allowed projects: ${delErr.message}`);
      }
      if (allowedProjectIds.length > 0) {
        const rows = allowedProjectIds.map((pid, idx) => ({
          channel_id: channelId,
          design_project_id: pid,
          sort_order: idx,
        }));
        const { error: insErr } = await supabase
          .from("channel_allowed_projects")
          .insert(rows);
        if (insErr) {
          toast.error(`Allowed projects: ${insErr.message}`);
        }
      }
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
          <div className="space-y-2 rounded-md border p-3 bg-muted/20">
            <div>
              <Label>{t("channelAllowedProjects")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("channelAllowedProjectsHint")}</p>
            </div>
            <div className="flex gap-2">
              <Select key={pickerKey} onValueChange={addAllowed}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={t("addProject")} />
                </SelectTrigger>
                <SelectContent>
                  {availableToAdd.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">—</div>
                  ) : (
                    availableToAdd.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            {allowedProjectIds.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">{t("noAllowedProjects")}</div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  拖曳調整順序，越上方優先播放
                </p>
                {allowedProjectIds.map((pid, idx) => {
                  const isDefault = defaultProjectId === pid;
                  const isDragging = dragIndex === idx;
                  const isDragOver = dragOverIndex === idx && dragIndex !== null && dragIndex !== idx;
                  return (
                    <div
                      key={pid}
                      draggable
                      onDragStart={(e) => {
                        setDragIndex(idx);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverIndex !== idx) setDragOverIndex(idx);
                      }}
                      onDragLeave={() => {
                        if (dragOverIndex === idx) setDragOverIndex(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIndex !== null) moveAllowed(dragIndex, idx);
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      className={`flex items-center gap-2 p-2 rounded-md bg-background border transition-all ${
                        isDragging ? "opacity-50" : ""
                      } ${isDragOver ? "border-primary ring-1 ring-primary" : ""}`}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0" />
                      <span className="text-xs text-muted-foreground w-5 text-center flex-shrink-0">{idx + 1}</span>
                      <span className="text-sm flex-1 truncate">{projectName(pid)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={idx === 0}
                        onClick={() => moveAllowed(idx, idx - 1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={idx === allowedProjectIds.length - 1}
                        onClick={() => moveAllowed(idx, idx + 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      {isDefault ? (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <Star className="h-3 w-3 fill-current" />{t("default")}
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => setDefaultProjectId(pid)}
                        >
                          <Star className="h-3 w-3 mr-1" />{t("setAsDefault")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeAllowed(pid)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
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