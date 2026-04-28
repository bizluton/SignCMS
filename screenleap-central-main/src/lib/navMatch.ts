/**
 * Shared pathname helpers for navigation / active-link matching.
 *
 * React Router's `location.pathname` already strips `?search` and `#hash`,
 * but some call sites receive raw `href` or `window.location.pathname`
 * variants that may include them. Normalize defensively so matching is
 * always done against a clean pathname.
 */

/** Strip query string and hash fragment from a path. */
export const normalizePath = (path: string): string =>
  (path || "").split("?")[0].split("#")[0];

/**
 * True when `currentPath` equals `target` or is a sub-route under it
 * (e.g. `/studio/123` matches `/studio`).
 */
export const isPathActive = (currentPath: string, target: string): boolean => {
  const cur = normalizePath(currentPath);
  return cur === target || cur.startsWith(target + "/");
};

/**
 * Given a list of nav target URLs and the current path, return the URL
 * to highlight. Falls back to the longest URL that is a prefix of the
 * current path (closest parent route). Root `/` is excluded from the
 * fallback so it doesn't catch every path.
 *
 * Returns `undefined` when no item matches.
 */
export const findActiveNavUrl = (
  urls: readonly string[],
  currentPath: string,
): string | undefined => {
  const cur = normalizePath(currentPath);

  const direct = urls.find((u) => isPathActive(cur, u));
  if (direct) return direct;

  const parent = [...urls]
    .filter((u) => u !== "/" && cur.startsWith(u))
    .sort((a, b) => b.length - a.length)[0];

  return parent;
};