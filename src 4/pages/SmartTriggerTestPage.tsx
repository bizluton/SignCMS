import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TriggerTestConsoleDialog } from "@/components/screens/TriggerTestConsoleDialog";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";

/**
 * Standalone Smart Trigger test page.
 *
 * Reuses the existing `TriggerTestConsoleDialog` UI (which already supports
 * manual event submission, matched_rules display, candidate rules, execution
 * logs, debug_id tracing and signed share links) by mounting it as the page's
 * primary surface. Closing returns to the previous route.
 */
export default function SmartTriggerTestPage() {
  const navigate = useNavigate();
  const { activeOrgId } = useActiveOrg();
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal header so the page is navigable even before the dialog mounts */}
      <div className="fixed top-3 left-3 z-[60]">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="w-4 h-4" /> 返回
        </Button>
      </div>

      <TriggerTestConsoleDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) navigate(-1);
        }}
        defaultOrgId={activeOrgId ?? undefined}
      />
    </div>
  );
}