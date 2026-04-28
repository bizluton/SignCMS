import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const RETRY_KEY = "errorboundary_chunk_retry";

function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { name?: string; message?: string };
  const name = err.name ?? "";
  const msg = err.message ?? "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /dynamically imported module/i.test(msg)
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string } | unknown) {
    console.error("ErrorBoundary caught:", error, info);

    // One-shot auto-retry on chunk-load failures (common after deploys / stale cache)
    if (isChunkLoadError(error)) {
      try {
        const alreadyRetried = sessionStorage.getItem(RETRY_KEY) === "1";
        if (!alreadyRetried) {
          sessionStorage.setItem(RETRY_KEY, "1");
          window.location.reload();
          return;
        }
        // Second failure — clear flag so future sessions can retry once again.
        sessionStorage.removeItem(RETRY_KEY);
      } catch {
        // sessionStorage unavailable — fall through to fallback UI.
      }
    }

    // Best-effort audit log (only when authenticated; RLS requires user_id = auth.uid()).
    void this.logToActivityLogs(error, info);
  }

  private async logToActivityLogs(error: Error, info: { componentStack?: string } | unknown) {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return;

      const componentStack =
        (info as { componentStack?: string } | null)?.componentStack ?? "";
      const stack = (error.stack ?? "").split("\n").slice(0, 5).join("\n");
      const detail = [
        `name: ${error.name || "Error"}`,
        `message: ${error.message || ""}`,
        `url: ${typeof window !== "undefined" ? window.location.href : ""}`,
        `userAgent: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
        stack ? `stack:\n${stack}` : "",
        componentStack ? `componentStack:${componentStack.split("\n").slice(0, 5).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000);

      await supabase.from("activity_logs").insert({
        user_id: userId,
        action: "client_error_boundary",
        category: "system",
        target_type: "frontend",
        target_name: (error.name || "Error").slice(0, 200),
        detail,
        detail_json: {
          name: error.name || "Error",
          message: error.message || "",
          url: typeof window !== "undefined" ? window.location.href : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          stack: (error.stack ?? "").split("\n").slice(0, 5).join("\n"),
          componentStack: componentStack ? componentStack.split("\n").slice(0, 5).join("\n") : "",
        },
      });
    } catch (e) {
      console.warn("ErrorBoundary failed to write activity log:", e);
    }
  }

  handleReload = () => {
    try {
      sessionStorage.removeItem(RETRY_KEY);
    } catch {
      /* noop */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The page failed to load. This can happen after a dev-server hiccup or stale module cache.
          </p>
          {this.state.error?.message && (
            <pre className="text-xs text-left bg-muted text-muted-foreground p-3 rounded-md overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
          )}
          <Button onClick={this.handleReload} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Reload page
          </Button>
        </div>
      </div>
    );
  }
}
