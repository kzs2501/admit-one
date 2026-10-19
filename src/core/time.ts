/**
 * Calendar days in a time zone. "Sales on Tuesday" means Tuesday where the organiser
 * is, not in UTC: an order at 23:30 UTC is the next morning in Kolkata. Days are ISO
 * dates (`2026-10-19`); instants are epoch milliseconds.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone: building them is the expensive part. */
function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClock(epochMs: number, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    asUtcMs: Date.UTC(
      Number(part("year")),
      Number(part("month")) - 1,
      Number(part("day")),
      Number(part("hour")),
      Number(part("minute")),
      Number(part("second")),
    ),
  };
}

/** `2026-10-19 09:42`: a local date and time, as spreadsheets read it. */
export function zonedDateTime(epochMs: number, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** The calendar day an instant falls on, in a zone. */
export const zonedDate = (epochMs: number, timeZone: string) => wallClock(epochMs, timeZone).date;

/** How far a zone's wall clock is ahead of UTC at an instant (+05:30 → 19,800,000). */
const offsetMs = (epochMs: number, timeZone: string) =>
  wallClock(epochMs, timeZone).asUtcMs - Math.floor(epochMs / 1000) * 1000;

/** The instant a calendar day begins in a zone: guess with today's offset, then correct once for a change in it. */
export function zonedDayStart(isoDate: string, timeZone: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  const asUtc = Date.UTC(year, month - 1, day);
  const guess = asUtc - offsetMs(asUtc, timeZone);
  return asUtc - offsetMs(guess, timeZone);
}

/** The next calendar day: `2026-10-31` → `2026-11-01`. */
export function nextDate(isoDate: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}
