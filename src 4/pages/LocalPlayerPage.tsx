import SignCMSPlayer from "@/components/SignCMSPlayer";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Standalone local-playback page. Loads a previously exported schedule ZIP
 * or folder from the user's machine — no auth, no DB. Designed for offline /
 * USB kiosk testing.
 */
export default function LocalPlayerPage() {
  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">SignCMS Local Player</h1>
            <p className="text-sm text-muted-foreground">
              Load an exported schedule (.zip) or unpacked folder to preview playback locally.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/publishing">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回 Publishing
            </Link>
          </Button>
        </header>
        <SignCMSPlayer />
      </div>
    </div>
  );
}
