import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle2, XCircle, Send, Copy } from "lucide-react";
import { toast } from "sonner";

interface VerifyResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  ms: number;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const ENDPOINT = `${SUPABASE_URL}/functions/v1/verify-device-license`;

export default function DeviceLicenseVerifyTester() {
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("device_models").select("id, name").order("sort_order").order("name");
      setModels(data || []);
    })();
  }, []);

  const callViaSdk = async () => {
    if (!model.trim() || !serial.trim() || !/^\d{6}$/.test(code.trim())) {
      toast.error("請輸入設備型號、序號，與 6 位數授權碼");
      return;
    }
    setLoading(true);
    setResult(null);
    const start = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke("verify-device-license", {
        body: { device_model: model.trim(), device_serial: serial.trim(), code: code.trim() },
      });
      const ms = Math.round(performance.now() - start);
      if (error) {
        // FunctionsHttpError exposes the response on context
        let body: Record<string, unknown> = { error: error.message };
        const ctxRes = (error as { context?: Response })?.context;
        let status = (error as { context?: { status?: number } })?.context?.status ?? 0;
        if (ctxRes && typeof ctxRes.text === "function") {
          try {
            const txt = await ctxRes.text();
            body = txt ? JSON.parse(txt) as Record<string, unknown> : body;
            status = ctxRes.status;
          } catch { /* ignore */ }
        }
        setResult({ ok: false, status, body, ms });
      } else {
        setResult({ ok: !!(data as Record<string, unknown>)?.valid, status: 200, body: (data as Record<string, unknown>) ?? {}, ms });
      }
    } catch (e: unknown) {
      setResult({ ok: false, status: 0, body: { error: e instanceof Error ? e.message : "network_error" }, ms: Math.round(performance.now() - start) });
    } finally {
      setLoading(false);
    }
  };

  const curlSample = `curl -X POST '${ENDPOINT}' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: ${SUPABASE_ANON}' \\
  -d '${JSON.stringify({ device_model: model || "SignCMS-Pro-X1", device_serial: serial || "SN-2026-00001", code: code || "123456" })}'`;

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已複製");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Send className="w-5 h-5" />
            設備端驗證測試
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            模擬設備呼叫 <code className="font-mono bg-muted px-1 rounded">verify-device-license</code>，
            傳入型號／序號／6 位數授權碼，查看是否合法以及綁定的組織與狀態。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>設備型號</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger><SelectValue placeholder="請選擇設備型號" /></SelectTrigger>
                <SelectContent>
                  {models.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">尚無型號</div>
                  ) : models.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>設備序號</Label>
              <Input value={serial} onChange={e => setSerial(e.target.value)} placeholder="例：SN-2026-00001" maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label>授權碼（6 位數）</Label>
              <Input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                className="font-mono tracking-widest"
              />
            </div>
          </div>
          <Button onClick={callViaSdk} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Send className="w-4 h-4 mr-2" />
            送出驗證請求
          </Button>

          {result && (
            <Alert variant={result.ok ? "default" : "destructive"}>
              <div className="flex items-center gap-2">
                {result.ok
                  ? <CheckCircle2 className="w-5 h-5 text-success" />
                  : <XCircle className="w-5 h-5" />}
                <AlertTitle className="m-0">
                  {result.ok ? "驗證通過 ✅" : "驗證失敗 ❌"}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    HTTP {result.status} · {result.ms} ms
                  </span>
                </AlertTitle>
              </div>
              <AlertDescription className="mt-3 space-y-2">
                {result.ok && result.body && (
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="default">組織：{result.body.org_name || "-"}</Badge>
                    <Badge variant="outline">org_id：<span className="font-mono ml-1">{result.body.org_id}</span></Badge>
                    <Badge variant="secondary">狀態：{result.body.status}</Badge>
                  </div>
                )}
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{JSON.stringify(result.body, null, 2)}
                </pre>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">設備端整合範例</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            設備端可直接 POST 到下列端點，回傳 <code className="font-mono">{`{ valid, org_id, org_name, status }`}</code>。
            驗證通過 HTTP 200，失敗則為 4xx/5xx。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground">Endpoint</Label>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => copy(ENDPOINT)}>
                <Copy className="w-3.5 h-3.5 mr-1" />複製
              </Button>
            </div>
            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto font-mono">{ENDPOINT}</pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground">cURL 範例</Label>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => copy(curlSample)}>
                <Copy className="w-3.5 h-3.5 mr-1" />複製
              </Button>
            </div>
            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre">{curlSample}</pre>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">回傳格式</Label>
            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto mt-1">
{`// 200 OK — 驗證通過
{
  "valid": true,
  "org_id": "uuid",
  "org_name": "組織名稱",
  "device_model": "...",
  "device_serial": "...",
  "status": "active"
}

// 403 Forbidden — 驗證失敗
{ "valid": false, "error": "not_found" | "code_mismatch" | "revoked" }

// 400 Bad Request — 參數錯誤
{ "valid": false, "error": "invalid_arguments" | "invalid_code_format" }`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
