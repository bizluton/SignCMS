/**
 * Timezone helpers for DST-correct, per-screen scheduling.
 *
 * The browser's `Date` object stores a UTC instant. Our publishing center
 * needs to answer: "Given a wall-clock date+time the admin picked (e.g.
 * 2024-04-26 10:00) and an IANA timezone (e.g. America/New_York), what is
 * the correct UTC instant for it — accounting for DST?"
 *
 * `Intl.DateTimeFormat` resolves the offset for any UTC instant in any
 * timezone. We binary-search by guess-and-correct: pick a UTC candidate,
 * see what wall-clock time it represents in `tz`, adjust by the difference,
 * and converge in 1–2 iterations. This handles DST transitions correctly,
 * including the "spring forward" gap (where we round to the next valid
 * instant) and "fall back" overlap (where we pick the first occurrence).
 */

function getTzOffsetMs(utcMs: number, timeZone: string): number {
  // Format the UTC instant in the target timezone, parse back to "as-if-UTC"
  // and the difference is the offset of that timezone at that instant.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const hour = Number(map.hour) % 24; // some locales emit 24
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - utcMs;
}

/**
 * Convert a wall-clock date+time in `timeZone` to a UTC `Date`.
 * `dateYYYYMMDD` is `"YYYY-MM-DD"`, `timeHHmm` is `"HH:mm"`.
 * DST-correct.
 */
export function zonedDateTimeToUtc(
  dateYYYYMMDD: string,
  timeHHmm: string,
  timeZone: string,
): Date {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const [hh, mm] = timeHHmm.split(":").map(Number);
  // First guess: treat the wall-clock as if it were UTC.
  const guess = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  // Adjust by the timezone offset at the guess, then once more to settle
  // around DST transitions.
  let utc = guess - getTzOffsetMs(guess, timeZone);
  utc = utc - (getTzOffsetMs(utc, timeZone) - getTzOffsetMs(guess, timeZone));
  return new Date(utc);
}

/** Format `Date` as `YYYY-MM-DD` in the given timezone. */
export function formatDateInTz(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(date);
}

/** Format `Date` as a readable wall-clock string in the given timezone. */
export function formatInTz(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date) + ` ${timeZone}`;
  } catch {
    return date.toISOString();
  }
}

/** Browser's IANA timezone, with safe fallback. */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}