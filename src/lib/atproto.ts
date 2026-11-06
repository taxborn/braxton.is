const DID = "did:plc:2grdruc2p6fjhksrfpt366yl";
const PDS = "https://pds.biscuits.at";
const TTL_MS = 5 * 60 * 1000;

type CacheEntry = { value: unknown; expires: number };
const cache = new Map<string, CacheEntry>();

/**
 * Fetch a record from my PDS. Cached in memory for 5 minutes; if the PDS is
 * unreachable, serves the stale value, or returns null if there is none.
 */
export async function getRecord<T = Record<string, unknown>>(
  collection: string,
  rkey = "self",
): Promise<T | null> {
  const key = `${collection}/${rkey}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  try {
    const params = new URLSearchParams({ repo: DID, collection, rkey });
    const res = await fetch(`${PDS}/xrpc/com.atproto.repo.getRecord?${params}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { value } = (await res.json()) as { value: T };
    cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    console.error(`atproto getRecord failed for ${key}:`, err);
    return (hit?.value as T | undefined) ?? null;
  }
}
