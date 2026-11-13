import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DID = "did:plc:2grdruc2p6fjhksrfpt366yl";
const PDS = "https://pds.biscuits.at";
const TTL_MS = 5 * 60 * 1000;

const RATE_LIMIT_PAUSE_MS = 60_000;
const FAILURE_BACKOFF_MS = 30_000;
// Set ATPROTO_CACHE_DIR to a persistent, writable path on the deployed server.
const CACHE_DIR = process.env.ATPROTO_CACHE_DIR ?? ".cache/atproto";

type CacheEntry = { value: unknown; expires: number };
const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const failures = new Map<string, { until: number; reason: string }>();
// Rate limits are per host: remember when each may be used again, and cap how
// many requests are in flight to it at once.
const hostPausedUntil = new Map<string, number>();
const hostSlots = new Map<
  string,
  { active: number; waiting: (() => void)[] }
>();
const MAX_PER_HOST = 3;

export type RepoRecord<T> = { uri: string; cid: string; value: T };

/** Read a bounded, newest-first window. Each collection fails independently. */
export async function listRecords<T>(
  collection: string,
  limit = 30,
  ttlMs = TTL_MS,
): Promise<RepoRecord<T>[] | null> {
  return cached(`${collection}/list/${limit}`, ttlMs, async () => {
    const { records } = await query<{ records: RepoRecord<T>[] }>(
      "com.atproto.repo.listRecords",
      { repo: DID, collection, limit: String(limit), reverse: "false" },
    );
    return records;
  });
}

/** Domain-keyed collections need every page before they can be sorted by date. */
export async function listAllRecords<T>(
  collection: string,
): Promise<RepoRecord<T>[] | null> {
  return cached(`${collection}/all`, TTL_MS, async () => {
    const records: RepoRecord<T>[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await query<{ records: RepoRecord<T>[]; cursor?: string }>(
        "com.atproto.repo.listRecords",
        { repo: DID, collection, limit: "100", ...(cursor ? { cursor } : {}) },
      );
      records.push(...page.records);
      cursor = page.cursor;
      if (cursor && cursors.has(cursor))
        throw new Error("Repeated pagination cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return records;
  });
}

export function getBlobUrl(cid: string): string {
  return `${PDS}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: DID, cid })}`;
}

/**
 * Cache a remote read in memory and on disk, stale-while-revalidate.
 *
 * - Fresh entries are served without touching the network.
 * - Expired entries are still served immediately while one background refresh
 *   runs, so a slow or rate-limited upstream never blocks a page.
 * - Concurrent callers for a key share one request.
 * - After a failure the key is left alone for a while, and after a 429 every
 *   key is, so a rate limit is not made worse by retrying on each request.
 * - The disk copy survives dev HMR reloads and server restarts/deploys.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T | null> {
  const hit = memory.get(key) ?? readDisk(key);
  if (hit) memory.set(key, hit);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const refresh = refreshEntry(key, ttlMs, load);
  if (hit) {
    void refresh;
    return hit.value as T;
  }
  return refresh;
}

function refreshEntry<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T | null> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T | null>;
  if (Date.now() < (failures.get(key)?.until ?? 0))
    return Promise.resolve(null);

  const run = (async () => {
    try {
      const value = await load();
      const entry = { value, expires: Date.now() + ttlMs };
      memory.set(key, entry);
      writeDisk(key, entry);
      failures.delete(key);
      return value;
    } catch (err) {
      failures.set(key, {
        until: Date.now() + FAILURE_BACKOFF_MS,
        reason: describeError(err),
      });
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  return cause ? `${message} (${describeError(cause)})` : message;
}

/** Why the last read of `key` failed, or a note if reads are paused. */
export function failureReason(key: string): string {
  return failures.get(key)?.reason ?? "no data";
}

function diskPath(key: string): string {
  return join(
    CACHE_DIR,
    `${createHash("sha256").update(key).digest("hex")}.json`,
  );
}

function readDisk(key: string): CacheEntry | undefined {
  try {
    return JSON.parse(readFileSync(diskPath(key), "utf8")) as CacheEntry;
  } catch {
    return undefined;
  }
}

function writeDisk(key: string, entry: CacheEntry): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const file = diskPath(key);
    // Write then rename so a concurrent reader never sees a partial file.
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, file);
  } catch {
    // The disk is an optimisation; an unwritable directory must not break pages.
  }
}

export async function query<T>(
  method: string,
  params: Record<string, string>,
  service = PDS,
): Promise<T> {
  const host = new URL(service).origin;
  const release = await acquireSlot(host);
  try {
    // Don't ask a host that already told us to back off.
    const pausedFor = (hostPausedUntil.get(host) ?? 0) - Date.now();
    if (pausedFor > 0)
      throw new XrpcError(429, `RateLimitExceeded (${host} paused)`, pausedFor);

    const res = await fetch(
      `${service}/xrpc/${method}?${new URLSearchParams(params)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      if (res.status === 429)
        hostPausedUntil.set(
          host,
          Date.now() + (retryAfterMs ?? RATE_LIMIT_PAUSE_MS),
        );
      throw new XrpcError(res.status, body?.error, retryAfterMs);
    }
    return (await res.json()) as T;
  } finally {
    release();
  }
}

async function acquireSlot(host: string): Promise<() => void> {
  const slots = hostSlots.get(host) ?? { active: 0, waiting: [] };
  hostSlots.set(host, slots);
  if (slots.active >= MAX_PER_HOST)
    await new Promise<void>((resolve) => slots.waiting.push(resolve));
  else slots.active++;
  // A released slot is handed straight to the next waiter, so `active` is kept.
  return () => {
    const next = slots.waiting.shift();
    if (next) next();
    else slots.active--;
  };
}

class XrpcError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(status: number, code?: string, retryAfterMs?: number) {
    super(`${status} ${code ?? ""}`.trim());
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retry-After is seconds or an HTTP date; clamp so a bad value can't wedge us. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const ms = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 15 * 60_000) : undefined;
}

/**
 * Fetch a record from my PDS, or null if it does not exist. Cached in memory
 * for 5 minutes; if the PDS is unreachable, serves the stale value, or returns
 * null if there is none.
 */
export async function getRecord<T = Record<string, unknown>>(
  collection: string,
  rkey = "self",
): Promise<T | null> {
  return cached(`${collection}/${rkey}`, TTL_MS, async () => {
    try {
      const { value } = await query<{ value: T }>(
        "com.atproto.repo.getRecord",
        { repo: DID, collection, rkey },
      );
      return value;
    } catch (err) {
      // A missing record is an answer, not an outage: cache it like one.
      if (err instanceof XrpcError && err.code === "RecordNotFound")
        return null;
      throw err;
    }
  });
}

/** Read the profile avatar and serve its blob directly from the PDS. */
export async function getProfileAvatarUrl(): Promise<string | null> {
  const profile = await getRecord<{
    avatar?: { ref: { $link: string } };
  }>("app.bsky.actor.profile");
  const cid = profile?.avatar?.ref?.$link;
  return cid ? getBlobUrl(cid) : null;
}

/**
 * Fetch the newest record in a collection on my PDS, or null if the collection
 * is empty. "Newest" is the highest record key, which for TID-keyed
 * collections is the most recently created. Cached like getRecord.
 */
export async function getLatestRecord<T = Record<string, unknown>>(
  collection: string,
  ttlMs = TTL_MS,
): Promise<T | null> {
  return cached(`${collection}/latest`, ttlMs, async () => {
    const { records } = await query<{ records: { value: T }[] }>(
      "com.atproto.repo.listRecords",
      { repo: DID, collection, limit: "1" },
    );
    return records[0]?.value ?? null;
  });
}
