export const DID = "did:plc:2grdruc2p6fjhksrfpt366yl";
const PDS = "https://pds.biscuits.at";
const TTL_MS = 5 * 60 * 1000;

type CacheEntry = { value: unknown; expires: number };
const cache = new Map<string, CacheEntry>();

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
 * Memoise a PDS read in memory. If the read fails, serves the stale value, or
 * null if there is none.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  try {
    const value = await load();
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  } catch (err) {
    console.error(`atproto read failed for ${key}:`, err);
    return (hit?.value as T | undefined) ?? null;
  }
}

export async function query<T>(
  method: string,
  params: Record<string, string>,
  service = PDS,
): Promise<T> {
  const res = await fetch(
    `${service}/xrpc/${method}?${new URLSearchParams(params)}`,
    { signal: AbortSignal.timeout(3000) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new XrpcError(res.status, body?.error);
  }
  return (await res.json()) as T;
}

class XrpcError extends Error {
  readonly code?: string;

  constructor(status: number, code?: string) {
    super(`${status} ${code ?? ""}`.trim());
    this.code = code;
  }
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
