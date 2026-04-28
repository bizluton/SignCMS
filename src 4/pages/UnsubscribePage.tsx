import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, MailX, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State = "loading" | "valid" | "used" | "invalid" | "done" | "error";

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState<State>("loading");
  const [email, setEmail] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: ANON } },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Invalid token");
        if (data?.used) setState("used");
        else {
          setEmail(data?.email || "");
          setState("valid");
        }
      } catch (e: any) {
        setErrorMsg(e?.message || String(e));
        setState("invalid");
      }
    })();
  }, [token]);

  const confirm = async () => {
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke(
      "handle-email-unsubscribe",
      { body: { token } },
    );
    setSubmitting(false);
    if (error || !(data as any)?.ok) {
      setErrorMsg((error as any)?.message || "Unsubscribe failed");
      setState("error");
    } else {
      setState("done");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-6 space-y-4">
        <div className="flex items-center gap-2">
          <MailX className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Unsubscribe</h1>
        </div>

        {state === "loading" && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Validating link…
          </div>
        )}

        {state === "valid" && (
          <>
            <p className="text-sm text-muted-foreground">
              Unsubscribe <span className="font-medium text-foreground">{email}</span>{" "}
              from automated reports and notifications?
            </p>
            <Button onClick={confirm} disabled={submitting} className="w-full">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirm unsubscribe
            </Button>
          </>
        )}

        {state === "used" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-success" /> You're already unsubscribed.
          </div>
        )}

        {state === "done" && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-success" /> You've been unsubscribed.
          </div>
        )}

        {(state === "invalid" || state === "error") && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4" />
            {errorMsg || "This unsubscribe link is invalid or expired."}
          </div>
        )}
      </Card>
    </div>
  );
}