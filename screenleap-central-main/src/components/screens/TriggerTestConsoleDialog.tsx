import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Play, AlertCircle, CheckCircle2, Link2, Clock, Plus, Trash2, ListChecks, Download, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { resolveScreenSmartTriggerRules } from "@/lib/smartTriggerResolver";
import { supabase } from "@/integrations/supabase/client";
import { encodeSharePayload, decodeSharePayload, signSharePayload, verifySharePayload, VerifyTransientError, PayloadTooLargeError } from "@/lib/triggerShareCodec";
import { createShareLinkLogger } from "@/lib/shareLinkLogger";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultOrgId?: string | null;
  defaultScreenId?: string | null;
}

interface Preset {
  id: string;
  name: string;
  orgId: string;
  screenId: string;
  triggerSource: string;
  triggerKey: string;
  payload: unknown;
}

interface PresetRunResult {
  presetId: string;
  ok: boolean;
  matchedCount: number;
  error?: string;
}

const newId = () => (crypto as { randomUUID?: () => string })?.randomUUID?.() ?? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function DiagRow({
  label,
  value,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  highlight?: "ok" | "warn" | "err";
  mono?: boolean;
}) {
  const cls =
    highlight === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : highlight === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : highlight === "err"
      ? "text-destructive"
      : "text-foreground";
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <span className={`${cls} ${mono ? "font-mono" : ""} break-all`}>{value}</span>
    </div>
  );
}

export function TriggerTestConsoleDialog({ open, onOpenChange, defaultOrgId, defaultScreenId }: Props) {
  const [orgId, setOrgId] = useState("");
  const [screenId, setScreenId] = useState("");
  const [triggerSource, setTriggerSource] = useState("webhook");
  const [triggerKey, setTriggerKey] = useState("");
  const [payloadText, setPayloadText] = useState('{\n  "value": 1\n}');
  const [running, setRunning] = useState(false);
  const [resolved, setResolved] = useState<Record<string, unknown>[]>([]);
  const [matched, setMatched] = useState<Record<string, unknown>[]>([]);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [response, setResponse] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareExpiry, setShareExpiry] = useState<string>(""); // datetime-local value
  const [linkExpired, setLinkExpired] = useState<{ at: string } | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState<string>("");
  const [batchResults, setBatchResults] = useState<PresetRunResult[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [parsedDiag, setParsedDiag] = useState<{
    tokenLength: number;
    decodedTopLevelKeys: string[] | null;
    isEnvelope: boolean;
    sigPresent: boolean;
    sigLength: number | null;
    dataKeys: string[] | null;
    presetCount: number | null;
    expiresAt: string | null;
    expiresAtIso: string | null;
    isExpired: boolean | null;
    correlationId: string;
  } | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [verification, setVerification] = useState<
    | { status: "none" }
    | { status: "missing"; reason: string }
    | { status: "unsigned"; reason: string }
    | { status: "invalid"; reason: string }
    | { status: "valid"; checkedAt: string; expiresAt?: string | null }
    | { status: "error"; reason: string }
  >({ status: "none" });

  /**
   * Parse `#trigger-test=...` from the current URL and apply it to the form.
   * Returns true if a valid (non-expired) link was applied.
   */
  const loadFromHash = async (opts?: { silent?: boolean }): Promise<boolean> => {
    const silent = opts?.silent ?? false;
    const logger = createShareLinkLogger();
    const cid = logger.correlationId;
    // Short help blurb appended to rejection toasts so users understand the
    // expected signed envelope shape without leaving the dialog.
    const ENVELOPE_HELP =
      '預期格式：{ "data": { ... 你的 payload ... }, "sig": "<base64url HMAC-SHA256>" }。' +
      "請使用本對話框的「複製分享連結」按鈕產生，由伺服器自動簽署，勿手動編輯 hash。";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const m = hash.match(/trigger-test=([^&]+)/);
    logger.log("load_start", "loadFromHash invoked", {
      silent,
      hasHash: Boolean(m),
      tokenLen: m?.[1]?.length ?? 0,
    });
    if (!m) {
      setVerification({ status: "missing", reason: "URL 中沒有 #trigger-test 參數" });
      setParsedDiag(null);
      if (!silent) toast.error("目前 URL 沒有 #trigger-test 參數");
      return false;
    }
    try {
      const decoded: unknown = await decodeSharePayload(decodeURIComponent(m[1]));
      let data: Record<string, unknown>;
      let isReadOnly = false;
      const isEnvelope =
        decoded && typeof decoded === "object" && "data" in decoded && "sig" in decoded;
      const decodedObj = decoded as Record<string, unknown>;
      const sigVal = isEnvelope ? decodedObj.sig : undefined;
      const dataPart: Record<string, unknown> | null = isEnvelope ? decodedObj.data as Record<string, unknown> : decoded as Record<string, unknown>;
      const expRaw =
        dataPart && typeof dataPart === "object" && typeof dataPart.expiresAt === "number"
          ? dataPart.expiresAt
          : null;
      setParsedDiag({
        tokenLength: m[1].length,
        decodedTopLevelKeys:
          decoded && typeof decoded === "object" ? Object.keys(decoded) : null,
        isEnvelope,
        sigPresent: typeof sigVal === "string" && sigVal.length > 0,
        sigLength: typeof sigVal === "string" ? sigVal.length : null,
        dataKeys:
          dataPart && typeof dataPart === "object" && !Array.isArray(dataPart)
            ? Object.keys(dataPart)
            : null,
        presetCount: Array.isArray(dataPart?.presets) ? dataPart.presets.length : null,
        expiresAt: expRaw ? new Date(expRaw).toLocaleString() : null,
        expiresAtIso: expRaw ? new Date(expRaw).toISOString() : null,
        isExpired: expRaw ? Date.now() > expRaw : null,
        correlationId: cid,
      });

      if (!isEnvelope) {
        // Unsigned / legacy payload — load in read-only mode (no execute / no save).
        logger.log("unsigned", "Decoded payload has no signature envelope", {
          decodedTopLevelKeys: decoded && typeof decoded === "object" ? Object.keys(decoded) : null,
        });
        setVerification({
          status: "unsigned",
          reason: `Payload 缺少 sig 欄位，已以唯讀模式載入 (cid=${cid})`,
        });
        if (!silent) {
          toast.warning("連結未簽署 — 已切換為唯讀模式", {
            description:
              `缺少伺服器簽章，無法保證內容未被竄改。表單會顯示連結內容但禁止執行測試或儲存 preset。\n\n${ENVELOPE_HELP}\n\nDebug ID: ${cid}`,
            action: {
              label: "重新產生連結",
              onClick: () => { void handleCopyShareLink(); },
            },
          });
        }
        data = decodedObj;
        isReadOnly = true;
      } else {
        // Verify with retry/backoff on transient (network/5xx) errors only.
        const MAX_ATTEMPTS = 4;
        const baseDelay = 400; // 400ms, 800ms, 1600ms, 3200ms
        let ok: boolean | null = null;
        let lastTransient: unknown = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            setVerification({
              status: "error",
              reason:
                attempt === 1
                  ? "正在驗證簽章…"
                  : `第 ${attempt}/${MAX_ATTEMPTS} 次重試簽章驗證… (cid=${cid})`,
            });
            ok = await verifySharePayload(decodedObj.data, decodedObj.sig as string);
            lastTransient = null;
            break;
          } catch (e) {
            if (e instanceof VerifyTransientError) {
              lastTransient = e;
              logger.log("verify_transient", "Transient verify failure", {
                attempt,
                maxAttempts: MAX_ATTEMPTS,
                error: (e as Error).message,
              });
              if (attempt < MAX_ATTEMPTS) {
                if (!silent) {
                  toast.message(`驗證服務暫時無法連線，${attempt === 1 ? "" : "再次"}重試中… (${attempt}/${MAX_ATTEMPTS})`);
                }
                logger.log("verify_retry", `Scheduling retry ${attempt + 1}`, {
                  delayMs: baseDelay * 2 ** (attempt - 1),
                });
                await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1)));
                continue;
              }
            } else {
              throw e;
            }
          }
        }
        if (ok === null) {
          logger.log("verify_failed_after_retry", "Gave up after retries", {
            attempts: MAX_ATTEMPTS,
            lastError: lastTransient instanceof Error ? lastTransient.message : null,
          });
          setVerification({
            status: "error",
            reason: `驗證服務多次重試後仍無法連線 (${lastTransient instanceof Error ? lastTransient.message : "network error"}) (cid=${cid})`,
          });
          if (!silent) {
            toast.error("無法驗證分享連結", {
              description: `已重試 ${MAX_ATTEMPTS} 次仍無法連線到驗證服務，請檢查網路後再點擊「從連結載入」重試。\nDebug ID: ${cid}`,
            });
          }
          return false;
        }
        if (!ok) {
          logger.log("invalid_signature", "Server reported HMAC mismatch", {
            sigLen: typeof decodedObj.sig === "string" ? decodedObj.sig.length : null,
          });
          setVerification({
            status: "invalid",
            reason: `HMAC 簽章與內容不符 (cid=${cid})`,
          });
          if (!silent) {
            toast.error("簽章驗證失敗 (Invalid signature)", {
              description:
                `連結內容與簽章不符，可能已被竄改或簽署金鑰已變更。已拒絕載入以保護您的安全。\n\n${ENVELOPE_HELP}\n\nDebug ID: ${cid}`,
              action: {
                label: "重新產生連結",
                onClick: () => { void handleCopyShareLink(); },
              },
            });
          }
          return false;
        }
        logger.log("valid", "Signature verified", { sigLen: typeof decodedObj.sig === "string" ? decodedObj.sig.length : 0 });
        data = decodedObj.data as Record<string, unknown>;
      }
      setReadOnly(isReadOnly);
      const expAt =
        data.expiresAt && typeof data.expiresAt === "number"
          ? new Date(data.expiresAt).toLocaleString()
          : null;
      if (!isReadOnly) {
        setVerification({
          status: "valid",
          checkedAt: new Date().toLocaleTimeString(),
          expiresAt: expAt,
        });
      }
      if (data.expiresAt && typeof data.expiresAt === "number" && Date.now() > data.expiresAt) {
        setLinkExpired({ at: new Date(data.expiresAt).toLocaleString() });
        logger.log("expired", "Link expired", { expiresAt: data.expiresAt });
        if (!silent) toast.error("此分享連結已過期");
        return false;
      }
      setLinkExpired(null);
      if (Array.isArray(data.presets) && data.presets.length > 0) {
        const incoming: Preset[] = (data.presets as Record<string, unknown>[]).map((p, i: number) => ({
          id: p.id ?? newId(),
          name: p.name ?? `Preset ${i + 1}`,
          orgId: p.orgId ?? "",
          screenId: p.screenId ?? "",
          triggerSource: p.triggerSource ?? "webhook",
          triggerKey: p.triggerKey ?? "",
          payload: p.payload ?? {},
        }));
        setPresets(incoming);
        const first = incoming[0];
        setOrgId(first.orgId); setScreenId(first.screenId);
        setTriggerSource(first.triggerSource); setTriggerKey(first.triggerKey);
        setPayloadText(JSON.stringify(first.payload, null, 2));
        if (!silent) toast.success(`已從連結載入 ${incoming.length} 個 preset`);
      } else {
        setOrgId(data.orgId ?? "");
        setScreenId(data.screenId ?? "");
        setTriggerSource(data.triggerSource ?? "webhook");
        setTriggerKey(data.triggerKey ?? "");
        if (data.payload !== undefined) {
          setPayloadText(typeof data.payload === "string" ? data.payload : JSON.stringify(data.payload, null, 2));
        }
        setPresets([{
          id: newId(), name: "Shared",
          orgId: data.orgId ?? "", screenId: data.screenId ?? "",
          triggerSource: data.triggerSource ?? "webhook",
          triggerKey: data.triggerKey ?? "",
          payload: data.payload ?? {},
        }]);
        if (!silent) toast.success("已從連結載入參數");
      }
      setError(null);
      return true;
    } catch (e: unknown) {
      if (e instanceof PayloadTooLargeError) {
        logger.log("payload_too_large", "Server returned 413", {
          receivedBytes: e.receivedBytes,
          maxBytes: e.maxBytes,
        });
        setVerification({
          status: "invalid",
          reason: `Payload 過大：${e.receivedBytes ?? "?"} / ${e.maxBytes ?? "?"} bytes (cid=${cid})`,
        });
        if (!silent) {
          toast.error("分享連結內容過大，已被伺服器拒絕", {
            description: `Payload ${e.receivedBytes ?? "?"} bytes 超過上限 ${e.maxBytes ?? "?"} bytes，已停止驗證並拒絕載入。請要求對方產生較小的分享連結。\nDebug ID: ${cid}`,
          });
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        logger.log("decode_failed", "Decode/parse error", { error: msg });
        setVerification({ status: "error", reason: `${msg} (cid=${cid})` });
        if (!silent) {
          toast.error("無法解析連結：" + msg, {
            description: `Debug ID: ${cid}`,
          });
        }
      }
      return false;
    }
  };

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLinkExpired(null);
      setBatchResults([]);
      setVerification({ status: "none" });
      setReadOnly(false);
      setParsedDiag(null);
      setDiagOpen(false);
      const loaded = await loadFromHash({ silent: true });
      if (!loaded) {
        setOrgId(defaultOrgId ?? "");
        setScreenId(defaultScreenId ?? "");
        setError(null);
        setPresets([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultOrgId, defaultScreenId]);

  const payloadValid = useMemo(() => {
    try { JSON.parse(payloadText); return true; } catch { return false; }
  }, [payloadText]);

  const buildCurrentAsPreset = (name?: string): Preset | null => {
    try {
      return {
        id: newId(),
        name: (name ?? presetName).trim() || `Preset ${presets.length + 1}`,
        orgId: orgId.trim(),
        screenId: screenId.trim(),
        triggerSource,
        triggerKey: triggerKey.trim(),
        payload: JSON.parse(payloadText),
      };
    } catch { return null; }
  };

  const handleSaveAsPreset = () => {
    if (!payloadValid) { toast.error("payload 不是有效的 JSON"); return; }
    if (!triggerKey.trim()) { toast.error("trigger_key 必填"); return; }
    const p = buildCurrentAsPreset();
    if (!p) return;
    setPresets((prev) => [...prev, p]);
    setPresetName("");
    toast.success(`已新增 preset：${p.name}`);
  };

  const handleLoadPreset = (p: Preset) => {
    setOrgId(p.orgId); setScreenId(p.screenId);
    setTriggerSource(p.triggerSource); setTriggerKey(p.triggerKey);
    setPayloadText(JSON.stringify(p.payload, null, 2));
    toast.success(`已載入：${p.name}`);
  };

  const handleDeletePreset = (id: string) =>
    setPresets((prev) => prev.filter((p) => p.id !== id));

  const handleCopyShareLink = async () => {
    // Build the bundle: include current form (if valid + has trigger_key) plus saved presets.
    const bundle: Preset[] = [...presets];
    if (payloadValid && triggerKey.trim()) {
      const cur = buildCurrentAsPreset(presetName || "Current");
      if (cur) {
        // Avoid duplicating an identical saved preset
        const dup = bundle.some((p) =>
          p.orgId === cur.orgId && p.screenId === cur.screenId &&
          p.triggerSource === cur.triggerSource && p.triggerKey === cur.triggerKey &&
          JSON.stringify(p.payload) === JSON.stringify(cur.payload),
        );
        if (!dup) bundle.push(cur);
      }
    }
    if (bundle.length === 0) {
      toast.error("沒有可分享的 preset，請先新增或填寫表單");
      return;
    }
    let expiresAt: number | undefined;
    if (shareExpiry) {
      const t = new Date(shareExpiry).getTime();
      if (Number.isNaN(t)) { toast.error("過期時間格式無效"); return; }
      if (t <= Date.now()) { toast.error("過期時間必須在未來"); return; }
      expiresAt = t;
    }
    try {
      const data = {
        v: 2,
        presets: bundle.map(({ id, name, orgId, screenId, triggerSource, triggerKey, payload }) =>
          ({ id, name, orgId, screenId, triggerSource, triggerKey, payload })),
        ...(expiresAt ? { expiresAt } : {}),
      };
      // Ask the server to HMAC-sign the data; embed signature in the envelope.
      let sig: string;
      try {
        sig = await signSharePayload(data);
      } catch (e: unknown) {
        if (e instanceof PayloadTooLargeError) {
          toast.error("分享內容過大，無法簽署", {
            description: `Payload ${e.receivedBytes ?? "?"} bytes 超過伺服器上限 ${e.maxBytes ?? "?"} bytes。請減少 preset 數量或縮減 payload 內容後再試。`,
          });
        } else {
          toast.error("無法取得簽章：" + (e instanceof Error ? e.message : String(e)));
        }
        return;
      }
      const envelope = { data, sig };
      const enc = await encodeSharePayload(envelope);
      const url = `${window.location.origin}${window.location.pathname}#trigger-test=${enc.encoded}`;
      // Warn if URL is approaching common browser limits (~2KB safe, 8KB hard).
      if (url.length > 8000) {
        toast.error(`連結過長 (${url.length} 字元)，可能無法在某些瀏覽器中開啟，請縮減 payload。`);
        return;
      }
      await navigator.clipboard.writeText(url);
      const ratio = enc.rawBytes > 0 ? Math.round((1 - enc.encodedBytes / enc.rawBytes) * 100) : 0;
      const sizeNote = enc.compressed
        ? `已壓縮 (${enc.rawBytes}B → ${enc.encodedBytes}B${ratio > 0 ? `, -${ratio}%` : ""})`
        : `${enc.encodedBytes}B`;
      toast.success(expiresAt
        ? `已複製已簽署連結 (${bundle.length} presets・${sizeNote}・${new Date(expiresAt).toLocaleString()} 過期)`
        : `已複製已簽署連結 (${bundle.length} presets・${sizeNote})`);
    } catch (e: unknown) {
      toast.error("複製失敗: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleRun = async () => {
    if (!orgId.trim()) { toast.error("org_id 必填"); return; }
    if (!triggerKey.trim()) { toast.error("trigger_key 必填"); return; }
    if (!payloadValid) { toast.error("payload 不是有效的 JSON"); return; }

    setRunning(true);
    setError(null);
    setResolved([]);
    setMatched([]);
    setLogs([]);
    setResponse(null);

    try {
      // Resolve effective rules
      const eff = await resolveScreenSmartTriggerRules({
        orgId: orgId.trim(),
        screenId: screenId.trim() || null,
        triggerSource,
        triggerKey: triggerKey.trim(),
        onlyEnabled: true,
      });
      setResolved(eff);

      // Invoke webhook
      const payload = JSON.parse(payloadText);
      const { data, error: fnError } = await supabase.functions.invoke("smart-trigger-webhook", {
        body: {
          org_id: orgId.trim(),
          screen_id: screenId.trim() || undefined,
          trigger_source: triggerSource,
          trigger_key: triggerKey.trim(),
          payload,
        },
      });
      if (fnError) throw fnError;
      setResponse(data as Record<string, unknown>);
      const responseData = data as Record<string, unknown> | null;
      const matchedRules = responseData?.matched_rules ?? responseData?.matched ?? [];
      setMatched(Array.isArray(matchedRules) ? matchedRules as Record<string, unknown>[] : []);

      // Fetch latest logs
      type SupabaseQuery = { select: (s: string) => SupabaseQuery; eq: (k: string, v: string) => SupabaseQuery; order: (k: string, o: { ascending: boolean }) => SupabaseQuery; limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null }> };
      type SupabaseDyn = { from: (t: string) => SupabaseQuery };
      const { data: logRows } = await (supabase as unknown as SupabaseDyn)
        .from("smart_trigger_logs")
        .select("*")
        .eq("org_id", orgId.trim())
        .eq("trigger_key", triggerKey.trim())
        .order("created_at", { ascending: false })
        .limit(10);
      setLogs(logRows ?? []);
      toast.success("測試完成");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("測試失敗: " + msg);
    } finally {
      setRunning(false);
    }
  };

  const handleRunAll = async () => {
    if (presets.length === 0) { toast.error("尚未新增任何 preset"); return; }
    setRunning(true);
    setError(null);
    setBatchResults([]);
    const results: PresetRunResult[] = [];
    for (const p of presets) {
      try {
        const { data, error: fnError } = await supabase.functions.invoke("smart-trigger-webhook", {
          body: {
            org_id: p.orgId,
            screen_id: p.screenId || undefined,
            trigger_source: p.triggerSource,
            trigger_key: p.triggerKey,
            payload: p.payload,
          },
        });
        if (fnError) throw fnError;
        const d = data as Record<string, unknown> | null;
        const matchedRulesArr = d?.matched_rules ?? d?.matched;
        const matchedCount = Array.isArray(matchedRulesArr) ? matchedRulesArr.length : 0;
        results.push({ presetId: p.id, ok: true, matchedCount });
      } catch (e: unknown) {
        results.push({ presetId: p.id, ok: false, matchedCount: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setBatchResults(results);
    setRunning(false);
    const okCount = results.filter((r) => r.ok).length;
    toast.success(`批次完成：${okCount}/${results.length} 成功`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="w-4 h-4" /> 觸發測試控制台</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {linkExpired && (
            <div className="border border-destructive/40 bg-destructive/10 text-destructive rounded-md p-3 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              此分享連結已於 {linkExpired.at} 過期，已忽略其中的參數。
            </div>
          )}
          {readOnly && (
            <div className="border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-md p-3 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                <strong>唯讀模式：</strong>此分享連結未簽署，內容僅供檢視。執行測試與儲存 preset 已停用，請向來源者要求重新產生簽署的連結。
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {(() => {
              const v = verification;
              const map: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
                none:     { cls: "border-border bg-muted text-muted-foreground", icon: ShieldAlert, label: "尚未檢查" },
                missing:  { cls: "border-border bg-muted text-muted-foreground", icon: ShieldAlert, label: "無分享連結" },
                unsigned: { cls: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", icon: ShieldAlert, label: "未簽署 (Unsigned)" },
                invalid:  { cls: "border-destructive/40 bg-destructive/10 text-destructive", icon: ShieldX, label: "簽章無效 (Invalid)" },
                valid:    { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", icon: ShieldCheck, label: "簽章有效 (Valid)" },
                error:    { cls: "border-destructive/40 bg-destructive/10 text-destructive", icon: ShieldX, label: "解析錯誤" },
              };
              const m = map[v.status];
              const Icon = m.icon;
              const detail =
                v.status === "valid"
                  ? `驗證時間 ${v.checkedAt}${v.expiresAt ? ` · 連結到期 ${v.expiresAt}` : ""}`
                  : v.status === "none" || v.status === "missing"
                  ? (v as any).reason ?? "開啟對話框時將自動驗證 URL 中的分享連結"
                  : (v as any).reason;
              return (
                <div className={`rounded-md border px-2.5 py-1.5 text-xs flex items-start gap-2 max-w-[70%] ${m.cls}`}>
                  <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium">分享連結驗證：{m.label}</span>
                    {detail && <span className="opacity-80 text-[11px]">{detail}</span>}
                  </div>
                </div>
              );
            })()}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadFromHash()}
              className="gap-1 h-7 text-xs"
              title="重新解析網址 #trigger-test=... 並套用到表單"
            >
              <Download className="w-3 h-3" /> 從連結載入
            </Button>
          </div>
          {parsedDiag && (
            <Collapsible open={diagOpen} onOpenChange={setDiagOpen} className="border rounded-md">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <ListChecks className="w-3.5 h-3.5" />
                    分享連結 Payload 診斷
                    <span className="text-muted-foreground font-normal">
                      ({parsedDiag.sigPresent ? "signed" : "unsigned"} ·{" "}
                      {parsedDiag.presetCount ?? 0} preset
                      {parsedDiag.expiresAt ? " · 含到期時間" : ""})
                    </span>
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${diagOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 pb-3 pt-1 text-xs space-y-1.5 border-t bg-muted/20">
                  <DiagRow label="Token 長度" value={`${parsedDiag.tokenLength} chars`} />
                  <DiagRow
                    label="頂層欄位"
                    value={parsedDiag.decodedTopLevelKeys?.join(", ") ?? "(非物件)"}
                  />
                  <DiagRow
                    label="是否為簽署 envelope"
                    value={parsedDiag.isEnvelope ? "是 ({ data, sig })" : "否（未簽署 / 舊版 / 直接 payload）"}
                    highlight={parsedDiag.isEnvelope ? "ok" : "warn"}
                  />
                  <DiagRow
                    label="sig 欄位"
                    value={
                      parsedDiag.sigPresent
                        ? `存在 (${parsedDiag.sigLength} chars base64url)`
                        : "缺少"
                    }
                    highlight={parsedDiag.sigPresent ? "ok" : "warn"}
                  />
                  <DiagRow
                    label="data 欄位"
                    value={parsedDiag.dataKeys?.join(", ") ?? "(無 / 非物件)"}
                  />
                  <DiagRow
                    label="presets 數量"
                    value={parsedDiag.presetCount === null ? "—" : String(parsedDiag.presetCount)}
                  />
                  <DiagRow
                    label="expiresAt"
                    value={
                      parsedDiag.expiresAt
                        ? `${parsedDiag.expiresAt} · ${parsedDiag.isExpired ? "已過期" : "有效"}`
                        : "未設定"
                    }
                    highlight={
                      parsedDiag.expiresAt
                        ? parsedDiag.isExpired
                          ? "err"
                          : "ok"
                        : undefined
                    }
                  />
                  <DiagRow
                    label="Debug ID"
                    value={parsedDiag.correlationId}
                    mono
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">org_id *</Label>
              <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="UUID" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">screen_id (可選)</Label>
              <Input value={screenId} onChange={(e) => setScreenId(e.target.value)} placeholder="UUID" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">trigger_source</Label>
              <Input value={triggerSource} onChange={(e) => setTriggerSource(e.target.value)} placeholder="webhook" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">trigger_key *</Label>
              <Input value={triggerKey} onChange={(e) => setTriggerKey(e.target.value)} placeholder="e.g. door.open" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-2">
              Payload (JSON)
              {!payloadValid && <span className="text-destructive text-[10px]">無效 JSON</span>}
            </Label>
            <Textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="font-mono text-xs min-h-[120px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-2">
              <Clock className="w-3 h-3" /> 分享連結過期時間 (可選)
              {shareExpiry && (
                <button
                  type="button"
                  onClick={() => setShareExpiry("")}
                  className="text-[10px] text-muted-foreground underline"
                >清除</button>
              )}
            </Label>
            <Input
              type="datetime-local"
              value={shareExpiry}
              onChange={(e) => setShareExpiry(e.target.value)}
              className="text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              留空 = 永不過期。設定後，超過此時間開啟連結時參數將被忽略。
            </p>
          </div>

          <div className="space-y-2 border border-border rounded-md p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-2">
                <ListChecks className="w-3 h-3" /> Presets ({presets.length})
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset 名稱"
                  className="h-7 text-xs w-40"
                />
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={handleSaveAsPreset}
                  disabled={!payloadValid || !triggerKey.trim() || readOnly}
                  className="gap-1 h-7"
                >
                  <Plus className="w-3 h-3" /> 新增目前
                </Button>
              </div>
            </div>
            {presets.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                尚未新增任何 preset。填好上方表單後按「新增目前」即可儲存為一個測試案例，分享連結會包含全部 preset。
              </p>
            ) : (
              <div className="space-y-1">
                {presets.map((p, idx) => {
                  const result = batchResults.find((r) => r.presetId === p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-2 border border-border rounded px-2 py-1.5 text-xs">
                      <span className="text-muted-foreground w-5">#{idx + 1}</span>
                      <span className="font-medium truncate flex-1">{p.name}</span>
                      <span className="text-muted-foreground font-mono truncate hidden md:inline">
                        {p.triggerSource}/{p.triggerKey || "—"}
                      </span>
                      {result && (
                        result.ok
                          ? <Badge variant="outline" className="gap-1"><CheckCircle2 className="w-3 h-3 text-success" />{result.matchedCount}</Badge>
                          : <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" />err</Badge>
                      )}
                      <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => handleLoadPreset(p)}>
                        載入
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-destructive" onClick={() => handleDeletePreset(p.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {(resolved.length > 0 || matched.length > 0 || logs.length > 0 || response || error) && (
            <>
            {response?.debug_id && (
              <div className="flex items-center gap-2 text-xs bg-muted/40 border border-border rounded-md px-3 py-2">
                <span className="text-muted-foreground">Debug ID</span>
                <code className="font-mono text-foreground">{response.debug_id}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 ml-auto"
                  onClick={() => {
                    navigator.clipboard.writeText(String(response.debug_id));
                    toast.success("已複製 Debug ID");
                  }}
                >
                  複製
                </Button>
              </div>
            )}
            <Tabs defaultValue="matched" className="w-full">
              <TabsList>
                <TabsTrigger value="matched">匹配規則 ({matched.length})</TabsTrigger>
                <TabsTrigger value="resolved">候選規則 ({resolved.length})</TabsTrigger>
                <TabsTrigger value="logs">執行日誌 ({logs.length})</TabsTrigger>
                <TabsTrigger value="raw">原始回應</TabsTrigger>
              </TabsList>

              <TabsContent value="matched" className="space-y-2">
                {matched.length === 0 ? (
                  <p className="text-xs text-muted-foreground">沒有規則匹配此 payload。</p>
                ) : matched.map((r: any) => (
                  <div key={r.id} className="border border-border rounded-md p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{r.name}</span>
                      <Badge variant="outline">priority {r.priority ?? 0}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{r.trigger_source}/{r.trigger_key}</p>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="resolved" className="space-y-2">
                {resolved.length === 0 ? (
                  <p className="text-xs text-muted-foreground">該 screen/org 沒有任何啟用的候選規則。</p>
                ) : resolved.map((r: any) => (
                  <div key={r.id} className="border border-border rounded-md p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{r.name}</span>
                      <div className="flex gap-1">
                        <Badge variant="secondary">{r.scope}</Badge>
                        <Badge variant="outline">priority {r.priority ?? 0}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{r.trigger_source}/{r.trigger_key}</p>
                    {r.trigger_condition && (
                      <pre className="text-[10px] bg-muted/40 rounded p-2 overflow-auto">{JSON.stringify(r.trigger_condition, null, 2)}</pre>
                    )}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="logs" className="space-y-2">
                {logs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">沒有歷史日誌。</p>
                ) : logs.map((l: any) => (
                  <div key={l.id} className="border border-border rounded-md p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        {l.success ? <CheckCircle2 className="w-3 h-3 text-success" /> : <AlertCircle className="w-3 h-3 text-destructive" />}
                        <span className="font-mono">{l.trigger_source}/{l.trigger_key}</span>
                      </span>
                      <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                    </div>
                    {l.error_message && <p className="text-destructive">{l.error_message}</p>}
                    {l.debug_id && (
                      <p className="text-[10px] text-muted-foreground font-mono">debug_id: {l.debug_id}</p>
                    )}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="raw">
                {error ? (
                  <pre className="text-xs bg-destructive/10 text-destructive rounded p-3 overflow-auto">{error}</pre>
                ) : (
                  <pre className="text-xs bg-muted/40 rounded p-3 overflow-auto max-h-[300px]">{JSON.stringify(response, null, 2)}</pre>
                )}
              </TabsContent>
            </Tabs>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCopyShareLink} disabled={!payloadValid} className="gap-2 mr-auto">
            <Link2 className="w-4 h-4" /> 複製分享連結
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
          <Button
            variant="outline"
            onClick={handleRunAll}
            disabled={running || presets.length === 0 || readOnly}
            className="gap-2"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
            執行全部 ({presets.length})
          </Button>
          <Button onClick={handleRun} disabled={running || !payloadValid || readOnly} className="gap-2" title={readOnly ? "唯讀模式：未簽署的分享連結禁止執行" : undefined}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            執行測試
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
