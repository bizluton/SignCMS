/**
 * notify() — thin wrapper around sonner's toast that deduplicates by message.
 *
 * Uses the message text as the toast `id`, so calling notify() twice with the
 * same message (e.g. from a rapid-fire realtime event) shows only one toast
 * instead of stacking duplicates.
 *
 * Use this for system-level / reactive notifications.
 * For one-off action responses (e.g. "Saved successfully") prefer toast() directly
 * so each action gets its own dismissible notification.
 */
import { toast } from "sonner";

type Level = "success" | "error" | "info" | "warning";

export function notify(
  level: Level,
  message: string,
  description?: string,
): void {
  const id = `${level}:${message}`;
  toast[level](message, { id, description });
}
