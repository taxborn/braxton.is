/** Dates are shown, and days are grouped, in my local time zone. */
export const TIME_ZONE = "America/Chicago";

const fullDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: TIME_ZONE,
});

/** "Thursday, November 12, 2026 at 6:12 AM", for labels read aloud. */
export function formatFullDate(date: Date): string {
  return fullDate.format(date);
}

/** Parse a record's datetime string, or null if it is missing or invalid. */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "just now", "5m ago", "3h ago", "2d ago", "6w ago", "1y ago". */
export function timeAgo(date: Date, now = Date.now()): string {
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 365)}y ago`;
}
