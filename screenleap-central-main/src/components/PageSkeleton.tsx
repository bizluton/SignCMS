import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic content-area skeleton used as Suspense fallback and during data fetches.
 * Preserves the visual rhythm of a typical dashboard page (header + stat cards + table)
 * so users see structure immediately instead of a blank screen.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-6 max-w-7xl animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Content block */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Lightweight full-screen fallback for very first paint (before layout mounts).
 * Keeps a subtle pulse so users know loading is in progress.
 */
export function RouteSkeleton() {
  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <PageSkeleton />
    </div>
  );
}
