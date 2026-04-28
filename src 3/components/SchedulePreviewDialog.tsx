import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import SignCMSPlayer from "@/components/SignCMSPlayer";
import { exportScheduleToZip } from "@/lib/exportSchedule";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * SchedulePreviewDialog
 *
 * Lets users preview a full schedule in a floating dialog without leaving
 * the Publishing Center. Internally it builds the same export bundle that
 * the Local Player consumes (in memory, no file download, no activity log)
 * and feeds it into a `SignCMSPlayer` instance via its `bootstrapBlob`
 * prop. The dialog cleans up the blob on close.
 */
export interface SchedulePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleId: string | null;
  scheduleName: string;
  orgId?: string | null;
}

export default function SchedulePreviewDialog({
  open, onOpenChange, scheduleId, scheduleName, orgId,
}: SchedulePreviewDialogProps) {
  const { user } = useAuth();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the export bundle on open; release it on close so the blob URL
  // and any downstream object URLs created by the player can be GC'd.
  useEffect(() => {
    if (!open || !scheduleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBlob(null);
    exportScheduleToZip({
      scheduleId,
      fallbackName: scheduleName,
      orgId: orgId ?? null,
      userId: user?.id ?? null,
      skipDownload: true,
      skipLog: true,
    })
      .then((res) => { if (!cancelled) setBlob(res.blob); })
      .catch((e) => {
        console.error("[SchedulePreviewDialog] build failed", e);
        if (!cancelled) {
          setError(e?.message || "Failed to build preview");
          toast.error("無法建立預覽");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, scheduleId, scheduleName, orgId, user?.id]);

  // Release blob reference when dialog is closed.
  useEffect(() => {
    if (!open) setBlob(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>預覽播放：{scheduleName}</DialogTitle>
          <DialogDescription>
            完整載入排程內容（含媒體、版型、BGM）並在浮動視窗中播放。關閉視窗即停止。
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6 max-h-[80vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在打包排程資源…
            </div>
          )}
          {error && !loading && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {blob && !loading && (
            <SignCMSPlayer bootstrapBlob={blob} compactUi autoPlay />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}