/**
 * db.ts — typed Supabase helpers.
 *
 * Background:
 *   The auto-generated `src/integrations/supabase/types.ts` already declares
 *   every table, view, and RPC. The `supabase` client is created with
 *   `createClient<Database>(...)`, so `supabase.from("foo").select("bar")`
 *   IS already typed against the generated schema.
 *
 *   In practice, ~26 call sites still use `as unknown as ...` to opt out of
 *   typing (often because someone added a new table/RPC in a migration but
 *   forgot to regenerate types.ts). Each of those casts is a chance for a
 *   real type bug to slip through.
 *
 *   This module gives you small, focused replacements for the most common
 *   "I just need to call this RPC" pattern, so you never need to write the
 *   `as unknown as (fn: string, args: ...) => Promise<...>` boilerplate.
 *
 * Operational note:
 *   When you add a SQL migration that introduces a new table, view, or RPC,
 *   regenerate types with:
 *
 *     npx supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts
 *
 *   After that, this helper isn't strictly needed for that new endpoint —
 *   `supabase.rpc("yourFunc", args)` will be fully typed by Database. The
 *   helper still gives you a slightly cleaner return shape.
 */

import { supabase } from "@/integrations/supabase/client";

export type RpcResult<T> =
  | { data: T;    error: null }
  | { data: null; error: { message: string; code?: string; details?: string } };

/**
 * Typed RPC call. Use this instead of `(supabase.rpc as unknown as ...)`.
 *
 * @example
 *   const { data, error } = await rpc<{ count: number }[]>("count_widgets", { _org_id });
 *
 * The downstream caller still has to know the shape of `data` — that's the
 * cost of using rpc() before the types are regenerated. If you DO regenerate
 * types.ts, prefer the native `supabase.rpc("countWidgets", ...)` directly.
 */
export async function rpc<T = unknown>(
  fn: string,
  args?: Record<string, unknown>,
): Promise<RpcResult<T>> {
  // The cast here is intentional and contained: callers no longer need to
  // repeat it at every call site, and the surface (one file) is reviewable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, args ?? {});
  if (error) {
    return { data: null, error: { message: error.message, code: error.code, details: error.details } };
  }
  return { data: data as T, error: null };
}
