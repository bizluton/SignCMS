import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { ShieldCheck, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
  customerId: string;
  customerName?: string | null;
}

export default function RequestDelegationDialog({
  open, onOpenChange, sessionId, customerId, customerName,
}: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [hours, setHours] = useState<"4" | "24" | "72">("24");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user) return;
    setSubmitting(true);
    const { error } = await (supabase as any).from("delegation_requests").insert({
      session_id: sessionId,
      requester_id: user.id,
      customer_id: customerId,
      hours: parseInt(hours, 10),
      reason: reason.trim(),
      status: "pending",
    });
    setSubmitting(false);
    if (error) {
      toast.error(t("delegationRequestSubmitFailed") + error.message);
      return;
    }
    toast.success(t("delegationRequestSubmitSuccess"));
    setReason("");
    onOpenChange(false);
  };

  const displayName = customerName || t("delegationRequestDefaultCustomer");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            {t("delegationRequestBtn")}
          </DialogTitle>
          <DialogDescription>
            {t("delegationRequestDialogDesc").replace("{name}", displayName)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("delegationRequestDuration")}</Label>
            <RadioGroup value={hours} onValueChange={(v) => setHours(v as "4" | "24" | "72")} className="grid grid-cols-3 gap-2">
              {(["4", "24", "72"] as const).map((h) => (
                <label key={h} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/50">
                  <RadioGroupItem value={h} id={`h-${h}`} />
                  <span className="text-sm">{t("delegationRequestHourUnit").replace("{hours}", h)}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">{t("delegationRequestReasonLabel")}</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("delegationRequestReasonPlaceholder")}
              maxLength={200}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("delegationRequestCancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("delegationRequestSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
