import { useEffect, useState } from "react";
import { Loader2, Zap, Radio, Cpu, Webhook, Activity, KeyRound, Clock, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export interface SmartTriggerRule {
  id?: string;
  org_id: string;
  scope: "org" | "screen";
  screen_id: string | null;
  mode: "shortcut" | "automation";
  name: string;
  description: string;
  icon: string;
  color: string;
  enabled: boolean;
  priority: number;
  trigger_source: "gpio" | "remote" | "api" | "iot_sensor" | "webhook" | "schedule";
  trigger_key: string;
  trigger_condition: Record<string, unknown>;
  target_design_project_id: string | null;
  duration_seconds: number;
  restore_behavior: "previous" | "channel" | "none";
  restore_channel_id: string | null;
  cooldown_seconds: number;
}

interface DesignProjectOption { id: string; name: string }
interface ChannelOption { id: string; name: string; color: string }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string;
  rule: SmartTriggerRule | null;
  onSaved: () => void;
}

const SHORTCUT_SOURCES = [
  { value: "remote", icon: Radio, label: { zh: "遙控器按鍵", en: "Remote Key", ja: "リモコンキー" }, ph: "KEY_F1" },
  { value: "gpio", icon: Cpu, label: { zh: "GPIO 腳位", en: "GPIO Pin", ja: "GPIO ピン" }, ph: "GPIO17" },
  { value: "api", icon: KeyRound, label: { zh: "API 鍵值", en: "API Key", ja: "API キー" }, ph: "promo_a" },
] as const;

const AUTOMATION_SOURCES = [
  { value: "iot_sensor", icon: Activity, label: { zh: "IoT 感測器", en: "IoT Sensor", ja: "IoT センサー" }, ph: "fire_alarm" },
  { value: "webhook", icon: Webhook, label: { zh: "外部 Webhook", en: "External Webhook", ja: "外部 Webhook" }, ph: "earthquake_alert" },
  { value: "schedule", icon: Clock, label: { zh: "定時觸發", en: "Scheduled", ja: "定時" }, ph: "daily_morning" },
] as const;

const COMPARISONS = [
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "eq", label: "=" },
] as const;

function emptyRule(orgId: string, userId: string | undefined): SmartTriggerRule {
  return {
    org_id: orgId,
    scope: "org",
    screen_id: null,
    mode: "shortcut",
    name: "",
    description: "",
    icon: "Zap",
    color: "#3b82f6",
    enabled: true,
    priority: 0,
    trigger_source: "remote",
    trigger_key: "",
    trigger_condition: {},
    target_design_project_id: null,
    duration_seconds: 0,
    restore_behavior: "previous",
    restore_channel_id: null,
    cooldown_seconds: 30,
  };
}

export function SmartTriggerDialog({ open, onOpenChange, orgId, rule, onSaved }: Props) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [form, setForm] = useState<SmartTriggerRule>(() => rule ?? emptyRule(orgId, user?.id));
  const [projects, setProjects] = useState<DesignProjectOption[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [saving, setSaving] = useState(false);

  const T = {
    titleNew: { zh: "新增智能觸發", en: "New Smart Trigger", ja: "新規スマートトリガー" }[language],
    titleEdit: { zh: "編輯智能觸發", en: "Edit Smart Trigger", ja: "スマートトリガー編集" }[language],
    desc: { zh: "用「當…就…」的方式設定螢幕自動切換規則。", en: "Configure when/then rules to auto-switch screens.", ja: "「いつ→なに」のルールで自動切替を設定。" }[language],
    mode: { zh: "模式", en: "Mode", ja: "モード" }[language],
    shortcut: { zh: "捷徑（手動觸發）", en: "Shortcut (manual)", ja: "ショートカット（手動）" }[language],
    automation: { zh: "自動化（事件觸發）", en: "Automation (event-driven)", ja: "オートメーション（イベント駆動）" }[language],
    name: { zh: "規則名稱", en: "Rule Name", ja: "ルール名" }[language],
    namePh: { zh: "例：F1 切到推廣專案", en: "e.g. F1 → Promo Project", ja: "例: F1で販促へ切替" }[language],
    descLabel: { zh: "說明（選填）", en: "Description (optional)", ja: "説明（任意）" }[language],
    when: { zh: "當…", en: "WHEN…", ja: "いつ…" }[language],
    triggerSource: { zh: "觸發來源", en: "Trigger Source", ja: "トリガー元" }[language],
    triggerKey: { zh: "識別值", en: "Identifier", ja: "識別子" }[language],
    condition: { zh: "條件", en: "Condition", ja: "条件" }[language],
    sensorType: { zh: "感測器類型", en: "Sensor Type", ja: "センサー種別" }[language],
    threshold: { zh: "閾值", en: "Threshold", ja: "閾値" }[language],
    then: { zh: "就…", en: "THEN…", ja: "なら…" }[language],
    targetProject: { zh: "切換到設計專案", en: "Switch to Design Project", ja: "デザインプロジェクトに切替" }[language],
    selectProject: { zh: "請選擇專案", en: "Select a project", ja: "プロジェクトを選択" }[language],
    duration: { zh: "持續時間（秒，0 = 不還原）", en: "Duration (seconds, 0 = no revert)", ja: "継続時間（秒、0 = 戻さない）" }[language],
    restore: { zh: "結束後行為", en: "After Duration", ja: "終了後の動作" }[language],
    restorePrevious: { zh: "回到原本播放內容", en: "Resume previous content", ja: "元の内容に戻る" }[language],
    restoreChannel: { zh: "切到指定頻道", en: "Switch to channel", ja: "指定チャンネルに切替" }[language],
    restoreNone: { zh: "保持不變", en: "Stay on target", ja: "そのまま" }[language],
    restoreChannelPick: { zh: "選擇頻道", en: "Select channel", ja: "チャンネル選択" }[language],
    cooldown: { zh: "冷卻（秒，避免短時間重複觸發）", en: "Cooldown (sec, prevent rapid retrigger)", ja: "クールダウン（秒）" }[language],
    enabled: { zh: "啟用此規則", en: "Enable this rule", ja: "このルールを有効化" }[language],
    cancel: { zh: "取消", en: "Cancel", ja: "キャンセル" }[language],
    save: { zh: "儲存", en: "Save", ja: "保存" }[language],
    needName: { zh: "請輸入名稱", en: "Please enter a name", ja: "名前を入力してください" }[language],
    needKey: { zh: "請輸入觸發識別值", en: "Please enter trigger identifier", ja: "識別子を入力してください" }[language],
    needTarget: { zh: "請選擇目標設計專案", en: "Please select a target project", ja: "対象プロジェクトを選択してください" }[language],
    saved: { zh: "已儲存", en: "Saved", ja: "保存しました" }[language],
  };

  useEffect(() => {
    if (open) setForm(rule ?? emptyRule(orgId, user?.id));
  }, [open, rule, orgId, user?.id]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [pj, ch] = await Promise.all([
        supabase.from("design_projects").select("id,name").eq("org_id", orgId).order("name"),
        supabase.from("channels").select("id,name,color").eq("org_id", orgId).order("name"),
      ]);
      setProjects((pj.data || []) as DesignProjectOption[]);
      setChannels((ch.data || []) as ChannelOption[]);
    })();
  }, [open, orgId]);

  const sources = form.mode === "shortcut" ? SHORTCUT_SOURCES : AUTOMATION_SOURCES;
  const currentSource = [...SHORTCUT_SOURCES, ...AUTOMATION_SOURCES].find((s) => s.value === form.trigger_source);

  const setMode = (m: "shortcut" | "automation") => {
    const defaultSource = m === "shortcut" ? "remote" : "iot_sensor";
    setForm((f) => ({ ...f, mode: m, trigger_source: defaultSource as SmartTriggerRule["trigger_source"], trigger_condition: {} }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error(T.needName); return; }
    if (!form.trigger_key.trim()) { toast.error(T.needKey); return; }
    if (!form.target_design_project_id) { toast.error(T.needTarget); return; }
    setSaving(true);
    const payload = {
      org_id: form.org_id,
      scope: form.scope,
      screen_id: form.scope === "screen" ? form.screen_id : null,
      mode: form.mode,
      name: form.name.trim(),
      description: form.description.trim(),
      icon: form.icon,
      color: form.color,
      enabled: form.enabled,
      priority: form.priority,
      trigger_source: form.trigger_source,
      trigger_key: form.trigger_key.trim(),
      trigger_condition: form.trigger_condition,
      target_design_project_id: form.target_design_project_id,
      duration_seconds: form.duration_seconds,
      restore_behavior: form.restore_behavior,
      restore_channel_id: form.restore_behavior === "channel" ? form.restore_channel_id : null,
      cooldown_seconds: form.cooldown_seconds,
      created_by: user?.id ?? null,
    };
    const { error } = form.id
      ? await (supabase as any).from("smart_trigger_rules").update(payload).eq("id", form.id)
      : await (supabase as any).from("smart_trigger_rules").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(T.saved);
    onSaved();
    onOpenChange(false);
  };

  const cond = form.trigger_condition as { op?: string; value?: number; sensor_type?: string };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            {form.id ? T.titleEdit : T.titleNew}
          </DialogTitle>
          <DialogDescription>{T.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("shortcut")}
              className={`text-left rounded-lg border-2 p-3 transition ${form.mode === "shortcut" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
            >
              <div className="flex items-center gap-2 font-semibold"><Zap className="w-4 h-4 text-primary" />{T.shortcut}</div>
              <p className="text-xs text-muted-foreground mt-1">{language === "zh" ? "按下按鍵立即切換" : language === "ja" ? "ボタンで即時切替" : "Trigger on key press"}</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("automation")}
              className={`text-left rounded-lg border-2 p-3 transition ${form.mode === "automation" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
            >
              <div className="flex items-center gap-2 font-semibold"><Activity className="w-4 h-4 text-primary" />{T.automation}</div>
              <p className="text-xs text-muted-foreground mt-1">{language === "zh" ? "感測器/事件達條件時自動切換" : language === "ja" ? "条件成立時に自動切替" : "Auto-switch on conditions"}</p>
            </button>
          </div>

          {/* Basic */}
          <div className="space-y-2">
            <Label>{T.name}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={T.namePh} />
          </div>
          <div className="space-y-2">
            <Label>{T.descLabel}</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          {/* WHEN block */}
          <Card className="p-4 space-y-3 bg-amber-500/5 border-amber-500/20">
            <div className="flex items-center gap-2">
              <Badge className="bg-amber-500 text-white">{T.when}</Badge>
              <span className="text-sm text-muted-foreground">{currentSource && language === "zh" ? "選擇觸發類型與識別值" : ""}</span>
            </div>
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-5">
                <Label className="text-xs text-muted-foreground">{T.triggerSource}</Label>
                <Select value={form.trigger_source} onValueChange={(v) => setForm({ ...form, trigger_source: v as SmartTriggerRule["trigger_source"], trigger_condition: {} })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        <span className="flex items-center gap-2"><s.icon className="w-3.5 h-3.5" />{s.label[language]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-7">
                <Label className="text-xs text-muted-foreground">{T.triggerKey}</Label>
                <Input
                  value={form.trigger_key}
                  onChange={(e) => setForm({ ...form, trigger_key: e.target.value })}
                  placeholder={currentSource?.ph}
                  className="h-9"
                />
              </div>
            </div>

            {/* IoT sensor extra condition */}
            {form.trigger_source === "iot_sensor" && (
              <div className="grid grid-cols-12 gap-2 pt-1">
                <div className="col-span-12">
                  <Label className="text-xs text-muted-foreground">{T.condition}</Label>
                </div>
                <div className="col-span-3">
                  <Select value={cond.op || "gt"} onValueChange={(v) => setForm({ ...form, trigger_condition: { ...cond, op: v } })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COMPARISONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-9">
                  <Input
                    type="number"
                    placeholder={T.threshold}
                    value={cond.value ?? ""}
                    onChange={(e) => setForm({ ...form, trigger_condition: { ...cond, value: e.target.value === "" ? undefined : Number(e.target.value) } })}
                    className="h-9"
                  />
                </div>
              </div>
            )}
          </Card>

          {/* THEN block */}
          <Card className="p-4 space-y-3 bg-emerald-500/5 border-emerald-500/20">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500 text-white">{T.then}</Badge>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{T.targetProject}</Label>
              <Select value={form.target_design_project_id ?? ""} onValueChange={(v) => setForm({ ...form, target_design_project_id: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder={T.selectProject} /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">{T.duration}</Label>
                <Input
                  type="number" min={0}
                  value={form.duration_seconds}
                  onChange={(e) => setForm({ ...form, duration_seconds: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{T.cooldown}</Label>
                <Input
                  type="number" min={0}
                  value={form.cooldown_seconds}
                  onChange={(e) => setForm({ ...form, cooldown_seconds: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-9"
                />
              </div>
            </div>

            {form.duration_seconds > 0 && (
              <div className="space-y-2 pt-1 border-t border-emerald-500/20">
                <Label className="text-xs text-muted-foreground flex items-center gap-1"><RotateCcw className="w-3 h-3" />{T.restore}</Label>
                <Select value={form.restore_behavior} onValueChange={(v) => setForm({ ...form, restore_behavior: v as SmartTriggerRule["restore_behavior"] })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="previous">{T.restorePrevious}</SelectItem>
                    <SelectItem value="channel">{T.restoreChannel}</SelectItem>
                    <SelectItem value="none">{T.restoreNone}</SelectItem>
                  </SelectContent>
                </Select>
                {form.restore_behavior === "channel" && (
                  <Select value={form.restore_channel_id ?? ""} onValueChange={(v) => setForm({ ...form, restore_channel_id: v })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder={T.restoreChannelPick} /></SelectTrigger>
                    <SelectContent>
                      {channels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />{c.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </Card>

          <label className="flex items-center justify-between p-3 rounded-lg border bg-card cursor-pointer">
            <span className="text-sm font-medium">{T.enabled}</span>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{T.cancel}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {T.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}