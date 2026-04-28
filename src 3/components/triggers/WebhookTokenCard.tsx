import { useEffect, useState } from "react";
import { Webhook, Copy, Check, RefreshCw, Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface Props {
  orgId: string;
  canManage: boolean;
}

export function WebhookTokenCard({ orgId, canManage }: Props) {
  const { language } = useLanguage();
  const [token, setToken] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const T = {
    title: { zh: "Webhook API Token", en: "Webhook API Token", ja: "Webhook API トークン" }[language],
    desc: {
      zh: "外部 IoT/系統呼叫 smart-trigger-webhook 端點時必須提供此 Token。請以 X-Webhook-Token: <token> header 傳送。",
      en: "External IoT/systems must provide this token when calling the smart-trigger-webhook endpoint. Send via X-Webhook-Token: <token> header.",
      ja: "外部 IoT/システムが smart-trigger-webhook エンドポイントを呼び出す際に必須です。X-Webhook-Token: <token> ヘッダで送信してください。",
    }[language],
    show: { zh: "顯示", en: "Show", ja: "表示" }[language],
    hide: { zh: "隱藏", en: "Hide", ja: "非表示" }[language],
    copy: { zh: "複製", en: "Copy", ja: "コピー" }[language],
    copied: { zh: "已複製", en: "Copied", ja: "コピー済" }[language],
    regen: { zh: "重新產生", en: "Regenerate", ja: "再生成" }[language],
    regenTitle: { zh: "確定要重新產生 Token？", en: "Regenerate token?", ja: "トークンを再生成しますか？" }[language],
    regenDesc: {
      zh: "重新產生後，舊的 Token 將立即失效，所有使用舊 Token 的外部裝置將收到 403 錯誤，請務必更新所有呼叫端的設定。",
      en: "The old token will be invalidated immediately. All external devices using it will receive 403. Update all integrations.",
      ja: "古いトークンは直ちに無効化され、使用中の外部機器は 403 を返します。すべての連携先を更新してください。",
    }[language],
    cancel: { zh: "取消", en: "Cancel", ja: "キャンセル" }[language],
    confirm: { zh: "確認重新產生", en: "Yes, regenerate", ja: "再生成する" }[language],
    noPerm: { zh: "沒有權限", en: "No permission", ja: "権限なし" }[language],
    masked: "•".repeat(48),
  };

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("organizations")
        .select("webhook_token")
        .eq("id", orgId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
      } else {
        setToken((data as any)?.webhook_token || "");
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast.success(T.copied);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleRegenerate = async () => {
    if (!canManage) {
      toast.error(T.noPerm);
      return;
    }
    setRegenerating(true);
    const { data, error } = await supabase.rpc("regenerate_org_webhook_token", { _org_id: orgId });
    setRegenerating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setToken(data as string);
    setRevealed(true);
    toast.success(T.copied + " ✓");
  };

  return (
    <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-emerald-500/15 flex items-center justify-center shrink-0">
          <Webhook className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm">{T.title}</h3>
            <Badge variant="outline" className="text-[10px] h-5">org-scoped</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{T.desc}</p>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Input
              readOnly
              value={loading ? "…" : (revealed ? token : (token ? T.masked : ""))}
              className="font-mono text-xs h-9 max-w-[460px] flex-1 min-w-[260px]"
              onFocus={(e) => revealed && e.currentTarget.select()}
            />
            <Button size="sm" variant="outline" onClick={() => setRevealed((v) => !v)} disabled={!token} className="gap-1.5">
              {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {revealed ? T.hide : T.show}
            </Button>
            <Button size="sm" variant="outline" onClick={handleCopy} disabled={!token} className="gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? T.copied : T.copy}
            </Button>
            {canManage && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={regenerating} className="gap-1.5 border-amber-500/40 hover:bg-amber-500/10">
                    {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {T.regen}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <ShieldAlert className="w-5 h-5 text-amber-500" />{T.regenTitle}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{T.regenDesc}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRegenerate} className="bg-amber-600 hover:bg-amber-700">
                      {T.confirm}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
