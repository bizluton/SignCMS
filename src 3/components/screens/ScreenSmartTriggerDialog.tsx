import { useEffect, useState } from "react";
import { Loader2, Plus, Zap, Pencil, Trash2, Radio, Cpu, KeyRound, Activity, Webhook, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { SmartTriggerDialog, type SmartTriggerRule } from "@/components/triggers/SmartTriggerDialog";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  screenId: string | null;
  screenName: string;
  orgId: string | null;
}

interface RuleRow extends SmartTriggerRule {
  id: string;
}

const SOURCE_ICON: Record<string, any> = {
  remote: Radio, gpio: Cpu, api: KeyRound, iot_sensor: Activity, webhook: Webhook, schedule: Clock,
};

export function ScreenSmartTriggerDialog({ open, onOpenChange, screenId, screenName, orgId }: Props) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [orgRules, setOrgRules] = useState<RuleRow[]>([]);
  const [screenRules, setScreenRules] = useState<RuleRow[]>([]);
  // override map: rule_id -> enabled (true=enabled override exists, false=disabled override exists, undefined=inherit)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<SmartTriggerRule | null>(null);

  const t = {
    title: { zh: "智能觸發 — ", en: "Smart Triggers — ", ja: "スマートトリガー — " }[language],
    desc: {
      zh: "此螢幕沿用組織規則（可個別停用），並可新增螢幕專屬規則。",
      en: "This screen inherits organization rules (toggle individually) and can have screen-specific rules.",
      ja: "組織ルールを継承し、画面専用ルールを追加できます。",
    }[language],
    orgRules: { zh: "繼承自組織的規則", en: "Inherited Organization Rules", ja: "組織から継承したルール" }[language],
    orgEmpty: { zh: "組織尚未建立規則", en: "No organization rules yet", ja: "組織ルールはまだありません" }[language],
    screenRules: { zh: "螢幕專屬規則", en: "Screen-Specific Rules", ja: "画面専用ルール" }[language],
    screenEmpty: { zh: "尚無螢幕專屬規則", en: "No screen-specific rules yet", ja: "画面専用ルールはまだありません" }[language],
    addRule: { zh: "新增螢幕規則", en: "Add Screen Rule", ja: "画面ルールを追加" }[language],
    inherited: { zh: "繼承", en: "Inherited", ja: "継承" }[language],
    overridden: { zh: "已覆寫", en: "Overridden", ja: "上書き" }[language],
    edit: { zh: "編輯", en: "Edit", ja: "編集" }[language],
    remove: { zh: "移除", en: "Remove", ja: "削除" }[language],
    confirmRemove: { zh: "確定移除此規則？此規則為螢幕專屬，移除後將無法復原。", en: "Remove this rule? This screen-specific rule cannot be recovered.", ja: "このルールを削除しますか？復元できません。" }[language],
    close: { zh: "關閉", en: "Close", ja: "閉じる" }[language],
    ruleDisabledGlobal: { zh: "（組織已停用）", en: "(disabled in org)", ja: "（組織で無効）" }[language],
    failedToLoad: { zh: "讀取失敗", en: "Failed to load", ja: "読み込み失敗" }[language],
  };

  useEffect(() => {
    if (!open || !screenId || !orgId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Fetch org rules (scope=org), screen-specific rules linked via screen_smart_trigger_rules, and overrides
      const [orgRes, linkRes, ovrRes] = await Promise.all([
        (supabase as any).from("smart_trigger_rules").select("*").eq("org_id", orgId).eq("scope", "org").order("priority", { ascending: false }).order("created_at", { ascending: false }),
        (supabase as any).from("screen_smart_trigger_rules").select("rule_id, smart_trigger_rules(*)").eq("screen_id", screenId),
        (supabase as any).from("screen_smart_trigger_overrides").select("rule_id, enabled").eq("screen_id", screenId),
      ]);
      if (cancelled) return;
      if (orgRes.error) toast.error(t.failedToLoad + ": " + orgRes.error.message);
      setOrgRules((orgRes.data || []) as RuleRow[]);
      const linked = ((linkRes.data || []) as any[]).map((r) => r.smart_trigger_rules).filter(Boolean);
      setScreenRules(linked as RuleRow[]);
      const map: Record<string, boolean> = {};
      ((ovrRes.data || []) as any[]).forEach((r) => { map[r.rule_id] = r.enabled; });
      setOverrides(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, screenId, orgId]);

  const reload = async () => {
    if (!screenId || !orgId) return;
    const [orgRes, linkRes, ovrRes] = await Promise.all([
      (supabase as any).from("smart_trigger_rules").select("*").eq("org_id", orgId).eq("scope", "org").order("priority", { ascending: false }).order("created_at", { ascending: false }),
      (supabase as any).from("screen_smart_trigger_rules").select("rule_id, smart_trigger_rules(*)").eq("screen_id", screenId),
      (supabase as any).from("screen_smart_trigger_overrides").select("rule_id, enabled").eq("screen_id", screenId),
    ]);
    setOrgRules((orgRes.data || []) as RuleRow[]);
    const linked = ((linkRes.data || []) as any[]).map((r) => r.smart_trigger_rules).filter(Boolean);
    setScreenRules(linked as RuleRow[]);
    const map: Record<string, boolean> = {};
    ((ovrRes.data || []) as any[]).forEach((r) => { map[r.rule_id] = r.enabled; });
    setOverrides(map);
  };

  const toggleOrgRule = async (ruleId: string, nextEnabled: boolean) => {
    if (!screenId) return;
    // Upsert override row
    const { error } = await (supabase as any).from("screen_smart_trigger_overrides").upsert({
      screen_id: screenId,
      rule_id: ruleId,
      enabled: nextEnabled,
    }, { onConflict: "screen_id,rule_id" });
    if (error) { toast.error(error.message); return; }
    setOverrides((prev) => ({ ...prev, [ruleId]: nextEnabled }));
  };

  const toggleScreenRule = async (ruleId: string, nextEnabled: boolean) => {
    const { error } = await (supabase as any).from("smart_trigger_rules").update({ enabled: nextEnabled }).eq("id", ruleId);
    if (error) { toast.error(error.message); return; }
    setScreenRules((prev) => prev.map((r) => r.id === ruleId ? { ...r, enabled: nextEnabled } : r));
  };

  const removeScreenRule = async (ruleId: string) => {
    if (!confirm(t.confirmRemove)) return;
    // Delete the underlying rule (cascade removes the link row)
    const { error } = await (supabase as any).from("smart_trigger_rules").delete().eq("id", ruleId);
    if (error) { toast.error(error.message); return; }
    setScreenRules((prev) => prev.filter((r) => r.id !== ruleId));
  };

  const openAddScreenRule = () => {
    if (!orgId || !screenId) return;
    setEditingRule({
      org_id: orgId,
      scope: "screen",
      screen_id: screenId,
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
      duration_seconds: 30,
      restore_behavior: "previous",
      restore_channel_id: null,
      cooldown_seconds: 5,
    });
    setEditorOpen(true);
  };

  const openEditScreenRule = (rule: RuleRow) => {
    setEditingRule({ ...rule });
    setEditorOpen(true);
  };

  const handleEditorSaved = async () => {
    setEditorOpen(false);
    setEditingRule(null);
    if (!screenId) return;
    // Ensure link row exists for newly created screen rules
    // (Edits keep their existing link; only new inserts need linking)
    // Fetch latest screen-scope rules for this screen and reconcile links
    const { data: latestScreenScopeRules } = await (supabase as any)
      .from("smart_trigger_rules")
      .select("id")
      .eq("scope", "screen")
      .eq("screen_id", screenId);
    const ids = ((latestScreenScopeRules || []) as any[]).map((r) => r.id);
    if (ids.length > 0) {
      const rows = ids.map((rule_id) => ({ screen_id: screenId, rule_id, created_by: user?.id ?? null }));
      await (supabase as any).from("screen_smart_trigger_rules").upsert(rows, { onConflict: "screen_id,rule_id" });
    }
    await reload();
  };

  const renderRuleCard = (rule: RuleRow, isOrgRule: boolean) => {
    const Icon = SOURCE_ICON[rule.trigger_source] || Zap;
    const overrideValue = overrides[rule.id];
    // For org rules: effective = (override defined ? override : rule.enabled)
    const effective = isOrgRule
      ? (overrideValue !== undefined ? overrideValue : rule.enabled)
      : rule.enabled;
    const showInheritedBadge = isOrgRule && overrideValue === undefined;
    const showOverriddenBadge = isOrgRule && overrideValue !== undefined;
    return (
      <Card key={rule.id} className="p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${rule.color}20`, color: rule.color }}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{rule.name || "(unnamed)"}</span>
            <Badge variant="outline" className="text-[10px] h-5">{rule.trigger_source}</Badge>
            {rule.trigger_key && <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{rule.trigger_key}</code>}
            {isOrgRule && !rule.enabled && <span className="text-[10px] text-muted-foreground">{t.ruleDisabledGlobal}</span>}
            {showInheritedBadge && <Badge variant="secondary" className="text-[10px] h-5">{t.inherited}</Badge>}
            {showOverriddenBadge && <Badge className="text-[10px] h-5 bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15">{t.overridden}</Badge>}
          </div>
          {rule.description && <div className="text-xs text-muted-foreground truncate mt-0.5">{rule.description}</div>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Switch
            checked={effective}
            disabled={isOrgRule && !rule.enabled}
            onCheckedChange={(v) => isOrgRule ? toggleOrgRule(rule.id, v) : toggleScreenRule(rule.id, v)}
          />
          {!isOrgRule && (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditScreenRule(rule)} title={t.edit}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeScreenRule(rule.id)} title={t.remove}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </Card>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              {t.title}{screenName}
            </DialogTitle>
            <DialogDescription>{t.desc}</DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Tabs defaultValue="org" className="flex-1 flex flex-col min-h-0">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="org">{t.orgRules} ({orgRules.length})</TabsTrigger>
                <TabsTrigger value="screen">{t.screenRules} ({screenRules.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="org" className="flex-1 min-h-0 mt-3">
                <ScrollArea className="h-[50vh] pr-3">
                  {orgRules.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-12">{t.orgEmpty}</div>
                  ) : (
                    <div className="space-y-2">{orgRules.map((r) => renderRuleCard(r, true))}</div>
                  )}
                </ScrollArea>
              </TabsContent>
              <TabsContent value="screen" className="flex-1 min-h-0 mt-3 flex flex-col gap-3">
                <div className="flex justify-end">
                  <Button size="sm" onClick={openAddScreenRule}>
                    <Plus className="w-4 h-4 mr-1" />{t.addRule}
                  </Button>
                </div>
                <ScrollArea className="h-[44vh] pr-3">
                  {screenRules.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-12">{t.screenEmpty}</div>
                  ) : (
                    <div className="space-y-2">{screenRules.map((r) => renderRuleCard(r, false))}</div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t.close}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {orgId && (
        <SmartTriggerDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          orgId={orgId}
          rule={editingRule}
          onSaved={handleEditorSaved}
        />
      )}
    </>
  );
}