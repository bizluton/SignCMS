import { useEffect, useState } from "react";
import { Loader2, Radio, Plus, Trash2, Tv, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useChannels } from "@/hooks/useChannels";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Subscription {
  id: string;
  channel_id: string;
  is_default: boolean;
}

interface Trigger {
  id: string;
  trigger_type: "gpio" | "remote" | "api";
  trigger_value: string;
  target_channel_id: string;
  enabled: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screenId: string | null;
  screenName: string;
  orgId: string | null;
}

const TRIGGER_TYPES: { value: Trigger["trigger_type"]; label: { zh: string; en: string; ja: string }; placeholder: string }[] = [
  { value: "gpio", label: { zh: "GPIO 腳位", en: "GPIO Pin", ja: "GPIO ピン" }, placeholder: "GPIO17" },
  { value: "remote", label: { zh: "遙控器按鍵", en: "Remote Key", ja: "リモコンキー" }, placeholder: "KEY_1" },
  { value: "api", label: { zh: "API 觸發鍵", en: "API Key", ja: "API キー" }, placeholder: "promo_a" },
];

export function ScreenChannelDialog({ open, onOpenChange, screenId, screenName, orgId }: Props) {
  const { language } = useLanguage();
  const { channels } = useChannels(orgId);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);

  const text = {
    title: { zh: "頻道訂閱與觸發切換", en: "Channel Subscriptions & Triggers", ja: "チャンネル購読とトリガー" }[language],
    subs: { zh: "訂閱頻道", en: "Subscribed Channels", ja: "購読チャンネル" }[language],
    subsHint: { zh: "勾選此螢幕可播放的頻道，並指定預設頻道。", en: "Select channels available on this screen and pick one default.", ja: "このスクリーンで利用するチャンネルを選び、デフォルトを指定します。" }[language],
    default: { zh: "預設", en: "Default", ja: "デフォルト" }[language],
    triggers: { zh: "切換觸發器", en: "Switch Triggers", ja: "切替トリガー" }[language],
    triggersHint: { zh: "GPIO / 遙控器 / API 訊號觸發時，自動切換到指定頻道。", en: "Auto-switch to a channel when GPIO / Remote / API fires.", ja: "GPIO/リモコン/API 受信時に自動でチャンネル切替。" }[language],
    addTrigger: { zh: "新增觸發器", en: "Add Trigger", ja: "トリガー追加" }[language],
    triggerType: { zh: "觸發類型", en: "Type", ja: "種別" }[language],
    triggerValue: { zh: "識別值", en: "Identifier", ja: "識別子" }[language],
    targetChannel: { zh: "目標頻道", en: "Target Channel", ja: "対象チャンネル" }[language],
    save: { zh: "儲存", en: "Save", ja: "保存" }[language],
    cancel: { zh: "取消", en: "Cancel", ja: "キャンセル" }[language],
    noChannels: { zh: "此組織尚未建立頻道，請先到「排程」頁面建立。", en: "No channels yet — create one on the Schedules page first.", ja: "チャンネルがありません。先に「スケジュール」で作成してください。" }[language],
    enabled: { zh: "啟用", en: "Enabled", ja: "有効" }[language],
  };

  useEffect(() => {
    if (!open || !screenId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [subRes, trgRes] = await Promise.all([
        (supabase as any).from("screen_channel_subscriptions").select("*").eq("screen_id", screenId),
        (supabase as any).from("screen_channel_switch_triggers").select("*").eq("screen_id", screenId).order("created_at", { ascending: true }),
      ]);
      if (!cancelled) {
        setSubs((subRes.data || []) as Subscription[]);
        setTriggers((trgRes.data || []) as Trigger[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, screenId]);

  const toggleSub = (channelId: string, checked: boolean) => {
    if (checked) {
      const isFirst = subs.length === 0;
      setSubs([...subs, { id: `tmp-${channelId}`, channel_id: channelId, is_default: isFirst }]);
    } else {
      const next = subs.filter((s) => s.channel_id !== channelId);
      // ensure a default exists if any remain
      if (next.length > 0 && !next.some((s) => s.is_default)) {
        next[0] = { ...next[0], is_default: true };
      }
      setSubs(next);
    }
  };

  const setDefault = (channelId: string) => {
    setSubs(subs.map((s) => ({ ...s, is_default: s.channel_id === channelId })));
  };

  const addTrigger = () => {
    if (channels.length === 0) return;
    setTriggers([
      ...triggers,
      { id: `tmp-${Date.now()}`, trigger_type: "gpio", trigger_value: "", target_channel_id: channels[0].id, enabled: true },
    ]);
  };

  const updateTrigger = (idx: number, patch: Partial<Trigger>) => {
    setTriggers(triggers.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const removeTrigger = (idx: number) => {
    setTriggers(triggers.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!screenId) return;
    // validate triggers
    for (const t of triggers) {
      if (!t.trigger_value.trim()) {
        toast.error(`${text.triggerValue} ?`);
        return;
      }
    }
    setSaving(true);
    // Replace strategy for both tables (small N, simplest correct approach)
    const [delSubs, delTrg] = await Promise.all([
      (supabase as any).from("screen_channel_subscriptions").delete().eq("screen_id", screenId),
      (supabase as any).from("screen_channel_switch_triggers").delete().eq("screen_id", screenId),
    ]);
    if (delSubs.error || delTrg.error) {
      toast.error((delSubs.error || delTrg.error).message);
      setSaving(false);
      return;
    }
    if (subs.length > 0) {
      const { error } = await (supabase as any).from("screen_channel_subscriptions").insert(
        subs.map((s) => ({ screen_id: screenId, channel_id: s.channel_id, is_default: s.is_default }))
      );
      if (error) { toast.error(error.message); setSaving(false); return; }
    }
    if (triggers.length > 0) {
      const { error } = await (supabase as any).from("screen_channel_switch_triggers").insert(
        triggers.map((t) => ({
          screen_id: screenId,
          target_channel_id: t.target_channel_id,
          trigger_type: t.trigger_type,
          trigger_value: t.trigger_value.trim(),
          enabled: t.enabled,
        }))
      );
      if (error) { toast.error(error.message); setSaving(false); return; }
    }
    setSaving(false);
    toast.success(text.save + " ✓");
    onOpenChange(false);
  };

  const subsByChannel = new Map(subs.map((s) => [s.channel_id, s]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" />
            {text.title} — {screenName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> ...
          </div>
        ) : channels.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{text.noChannels}</div>
        ) : (
          <Tabs defaultValue="subs">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="subs" className="gap-1.5"><Tv className="w-3.5 h-3.5" />{text.subs}</TabsTrigger>
              <TabsTrigger value="triggers" className="gap-1.5"><Zap className="w-3.5 h-3.5" />{text.triggers}</TabsTrigger>
            </TabsList>

            <TabsContent value="subs" className="space-y-3 pt-3">
              <p className="text-xs text-muted-foreground">{text.subsHint}</p>
              <div className="space-y-2">
                {channels.map((c) => {
                  const sub = subsByChannel.get(c.id);
                  const subscribed = !!sub;
                  return (
                    <Card key={c.id} className="p-3 flex items-center gap-3">
                      <Checkbox
                        checked={subscribed}
                        onCheckedChange={(v) => toggleSub(c.id, !!v)}
                      />
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        {c.description && <div className="text-xs text-muted-foreground truncate">{c.description}</div>}
                      </div>
                      {subscribed && (
                        sub?.is_default ? (
                          <Badge variant="default">{text.default}</Badge>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setDefault(c.id)}>
                            {text.default}
                          </Button>
                        )
                      )}
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="triggers" className="space-y-3 pt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{text.triggersHint}</p>
                <Button size="sm" variant="outline" onClick={addTrigger} className="gap-1">
                  <Plus className="w-3.5 h-3.5" />{text.addTrigger}
                </Button>
              </div>
              {triggers.length === 0 ? (
                <Card className="p-6 text-center text-xs text-muted-foreground">—</Card>
              ) : (
                <div className="space-y-2">
                  {triggers.map((t, i) => {
                    const cfg = TRIGGER_TYPES.find((x) => x.value === t.trigger_type)!;
                    return (
                      <Card key={t.id} className="p-3 space-y-2">
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-3 space-y-1">
                            <Label className="text-[11px] text-muted-foreground">{text.triggerType}</Label>
                            <Select value={t.trigger_type} onValueChange={(v) => updateTrigger(i, { trigger_type: v as Trigger["trigger_type"] })}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {TRIGGER_TYPES.map((tt) => (
                                  <SelectItem key={tt.value} value={tt.value}>{tt.label[language]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-3 space-y-1">
                            <Label className="text-[11px] text-muted-foreground">{text.triggerValue}</Label>
                            <Input
                              value={t.trigger_value}
                              placeholder={cfg.placeholder}
                              onChange={(e) => updateTrigger(i, { trigger_value: e.target.value })}
                              className="h-8"
                            />
                          </div>
                          <div className="col-span-5 space-y-1">
                            <Label className="text-[11px] text-muted-foreground">{text.targetChannel}</Label>
                            <Select value={t.target_channel_id} onValueChange={(v) => updateTrigger(i, { target_channel_id: v })}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {channels.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-1 flex items-end">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeTrigger(i)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Checkbox checked={t.enabled} onCheckedChange={(v) => updateTrigger(i, { enabled: !!v })} />
                          {text.enabled}
                        </label>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">{text.cancel}</Button></DialogClose>
          <Button onClick={handleSave} disabled={saving || loading || channels.length === 0}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {text.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}