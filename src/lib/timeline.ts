import type {
  AppBskyFeedPost,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
} from "@atproto/api";
import { parseAtUri, WAYPOINT_DESTINATIONS_DATA } from "@aturi.to/waypoints";
import {
  getBlobUrl,
  listAllRecords,
  listRecords,
  type RepoRecord,
} from "./atproto";
import { parseDate } from "./format";
import { getStateFromRef, parseState, type State } from "./now";
import { getTangledTimeline, type TangledCard } from "./tangled";

export type TextPart = { text: string; href?: string };
type Image = { src: string; alt: string; width?: number; height?: number };
type Base = { uri: string; createdAt: Date };
export type PostEntry = Base & {
  kind: "post";
  href: string;
  text: TextPart[];
  images: Image[];
  external?: { uri: string; title: string; description: string };
  quoteHref?: string;
  replyHref?: string;
};
export type StatusEntry = Base & {
  kind: "now";
  status: string;
  /** The reading taken with this status, if it has one. */
  state: State | null;
};
export type StateEntry = Base & { kind: "state"; state: State };
export type DomainEntry = Base & {
  kind: "domain";
  name: string;
  href: string;
  status: string | null;
  verifiedHandle: string | null;
};
export type TangledEntry = Base & {
  kind: "repo" | "activity";
  card: TangledCard;
};
export type TimelineEntry =
  PostEntry | StatusEntry | StateEntry | DomainEntry | TangledEntry;
export type TimelineKind = TimelineEntry["kind"];

type NowRecord = {
  status?: string;
  createdAt?: string;
  stateRef?: { uri: string };
};
type StateRecord = Record<string, unknown> & { createdAt?: string };
type DomainRecord = {
  domain?: string;
  createdAt?: string;
  status?: string;
  atprotoVerified?: boolean;
  atprotoHandle?: string;
};

/** Only web links are rendered, including links from user-supplied facets. */
export function webUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function postUrl(uri: string): string | undefined {
  const match = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  return match
    ? `https://bsky.app/profile/${encodeURIComponent(match[1]).replace(/%3A/g, ":")}/post/${encodeURIComponent(match[2])}`
    : undefined;
}

/** Explorer paths use repo/collection/rkey, without the AT URI scheme. */
export function aturiUrl(uri: string): string {
  const parsed = parseAtUri(uri)?.parsed;
  if (!parsed) throw new Error(`Invalid AT URI: ${uri}`);
  const url = WAYPOINT_DESTINATIONS_DATA.aturiExplore.getUrl(
    parsed.handle,
    parsed.collection,
    parsed.rkey,
    parsed.did,
  );
  if (!url) throw new Error(`Cannot build Aturi explorer link: ${uri}`);
  return url;
}

/** Facet offsets count UTF-8 bytes, rather than JavaScript characters. */
export function postText(record: AppBskyFeedPost.Record): TextPart[] {
  const bytes = new TextEncoder().encode(record.text);
  const decoder = new TextDecoder();
  const parts: TextPart[] = [];
  let offset = 0;
  for (const facet of [...(record.facets ?? [])].sort(
    (a, b) => a.index.byteStart - b.index.byteStart,
  )) {
    const { byteStart: start, byteEnd: end } = facet.index;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < offset ||
      end <= start ||
      end > bytes.length
    )
      continue;
    if (start > offset)
      parts.push({ text: decoder.decode(bytes.slice(offset, start)) });
    let href: string | undefined;
    for (const feature of facet.features) {
      if (
        feature.$type === "app.bsky.richtext.facet#link" &&
        "uri" in feature &&
        typeof feature.uri === "string"
      )
        href = webUrl(feature.uri);
      if (
        feature.$type === "app.bsky.richtext.facet#mention" &&
        "did" in feature &&
        typeof feature.did === "string"
      )
        href = `https://bsky.app/profile/${feature.did}`;
      if (
        feature.$type === "app.bsky.richtext.facet#tag" &&
        "tag" in feature &&
        typeof feature.tag === "string"
      )
        href = `https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}`;
    }
    parts.push({ text: decoder.decode(bytes.slice(start, end)), href });
    offset = end;
  }
  if (offset < bytes.length)
    parts.push({ text: decoder.decode(bytes.slice(offset)) });
  return parts;
}

function postMedia(record: AppBskyFeedPost.Record) {
  let embed = record.embed;
  let quoteHref: string | undefined;
  if (embed?.$type === "app.bsky.embed.recordWithMedia") {
    const combined = embed as AppBskyEmbedRecordWithMedia.Main;
    quoteHref = postUrl(combined.record.record.uri);
    embed = combined.media;
  }
  if (embed?.$type === "app.bsky.embed.record") {
    quoteHref = postUrl((embed as AppBskyEmbedRecord.Main).record.uri);
  }
  const images =
    embed?.$type === "app.bsky.embed.images"
      ? (embed as AppBskyEmbedImages.Main).images.map((image) => {
          // PDS JSON has a $link; an SDK BlobRef has a hydrated CID instead.
          const ref = image.image.ref as unknown as { $link?: string };
          return {
            src: getBlobUrl(ref.$link ?? image.image.ref.toString()),
            alt: image.alt,
            width: image.aspectRatio?.width,
            height: image.aspectRatio?.height,
          };
        })
      : [];
  const link =
    embed?.$type === "app.bsky.embed.external"
      ? (embed as AppBskyEmbedExternal.Main).external
      : undefined;
  const uri = link && webUrl(link.uri);
  return {
    images,
    quoteHref,
    external:
      link && uri
        ? { uri, title: link.title, description: link.description }
        : undefined,
  };
}

export function postEntries(
  posts: RepoRecord<AppBskyFeedPost.Record>[],
): PostEntry[] {
  return posts.flatMap(({ uri, value }) => {
    const createdAt = parseDate(value.createdAt);
    const href = postUrl(uri);
    if (!createdAt || !href || typeof value.text !== "string") return [];
    return {
      uri,
      kind: "post",
      createdAt,
      href,
      text: postText(value),
      replyHref: value.reply ? postUrl(value.reply.parent.uri) : undefined,
      ...postMedia(value),
    };
  });
}

/**
 * A status takes its reading from the listed states when it is there, and
 * otherwise follows the ref. `linked` collects the readings that were used, so
 * they are not shown a second time as entries of their own.
 */
async function statusEntries(
  statuses: RepoRecord<NowRecord>[],
  states: RepoRecord<StateRecord>[],
  linked: Set<string>,
): Promise<StatusEntry[]> {
  const stateByUri = new Map(states.map(({ uri, value }) => [uri, value]));
  const entries = await Promise.all(
    statuses.map(async ({ uri, value }): Promise<StatusEntry | null> => {
      const createdAt = parseDate(value.createdAt);
      const status =
        typeof value.status === "string" ? value.status.trim() : "";
      if (!createdAt || !status) return null;
      const stateUri = value.stateRef?.uri;
      const listed = stateUri ? stateByUri.get(stateUri) : undefined;
      const state = listed
        ? parseState(listed)
        : await getStateFromRef(value.stateRef);
      if (stateUri && state) linked.add(stateUri);
      return { uri, kind: "now", createdAt, status, state };
    }),
  );
  return entries.filter((entry) => entry !== null);
}

export function stateEntries(
  states: RepoRecord<StateRecord>[],
  linked: ReadonlySet<string> = new Set(),
): StateEntry[] {
  return states.flatMap(({ uri, value }) => {
    const createdAt = parseDate(value.createdAt);
    const state = parseState(value);
    if (!createdAt || !state || linked.has(uri)) return [];
    return { uri, kind: "state", createdAt, state };
  });
}

// A domain must be a hostname, with no URL path, credentials, or port.
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function domainEntries(
  domains: RepoRecord<DomainRecord>[],
): DomainEntry[] {
  return domains.flatMap(({ uri, value }) => {
    const createdAt = parseDate(value.createdAt);
    const name =
      typeof value.domain === "string" ? value.domain.trim().toLowerCase() : "";
    if (!createdAt || !HOSTNAME.test(name)) return [];
    return {
      uri,
      kind: "domain",
      createdAt,
      name,
      href: `https://${name}/`,
      status: typeof value.status === "string" ? value.status : null,
      verifiedHandle:
        value.atprotoVerified === true &&
        typeof value.atprotoHandle === "string"
          ? value.atprotoHandle
          : null,
    };
  });
}

function tangledEntries(cards: TangledCard[]): TangledEntry[] {
  return cards.map((card) => ({
    // Daily activity has no record of its own. Explore a ticket when present,
    // otherwise the repository manifest that backs the card.
    uri:
      card.items.find((item) => item.kind === "pull")?.id ??
      `at://${card.repo.did}/org.tangled.repo.manifest/self`,
    kind: card.kind,
    createdAt: card.createdAt,
    card,
  }));
}

export async function getTimeline(): Promise<{
  entries: TimelineEntry[];
  unavailable: boolean;
}> {
  const [posts, statuses, states, domains, tangled] = await Promise.all([
    listRecords<AppBskyFeedPost.Record>("app.bsky.feed.post"),
    listRecords<NowRecord>("is.braxton.now", 30, 60_000),
    listRecords<StateRecord>("is.braxton.state", 30, 60_000),
    listAllRecords<DomainRecord>("at.marque.domain"),
    getTangledTimeline(),
  ]);
  const linkedStates = new Set<string>();
  const entries: TimelineEntry[] = [
    ...(await statusEntries(statuses ?? [], states ?? [], linkedStates)),
    ...stateEntries(states ?? [], linkedStates),
    ...postEntries(posts ?? []),
    ...domainEntries(domains ?? []),
    ...tangledEntries(tangled.cards),
  ];
  return {
    entries: entries.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    ),
    unavailable:
      tangled.unavailable ||
      [posts, statuses, states, domains].some((records) => records === null),
  };
}
