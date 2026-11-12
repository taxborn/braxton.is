import { getLatestRecord } from "./atproto";

// Short, so a status posted from the Shortcut shows up within a minute.
const TTL_MS = 60 * 1000;

export type Now = { status: string; createdAt: Date | null };

/** The latest is.braxton.now record (see lexicons/NOW.md), or null if none. */
export async function getNow(): Promise<Now | null> {
  const record = await getLatestRecord<{
    status?: unknown;
    createdAt?: unknown;
  }>("is.braxton.now", TTL_MS);
  const status = typeof record?.status === "string" ? record.status.trim() : "";
  if (!status) return null;

  const createdAt = new Date(
    typeof record?.createdAt === "string" ? record.createdAt : NaN,
  );
  return {
    status,
    createdAt: Number.isNaN(createdAt.getTime()) ? null : createdAt,
  };
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
