import type {
  AppBskyFeedPost,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
} from "@atproto/api";
import { DID, getBlobUrl, listAllRecords, listRecords } from "./atproto";
import { getStateFromRef, parseState, type State } from "./now";
import { getTangledTimeline, type TangledCard } from "./tangled";

export type TimelineKind =
  "post" | "now" | "state" | "domain" | "repo" | "activity";
export type TextPart = { text: string; href?: string };
type Image = { src: string; alt: string; width?: number; height?: number };
export type TimelineEntry = {
  uri: string;
  kind: TimelineKind;
  createdAt: Date;
  href: string;
  text: TextPart[];
  state: State | null;
  images: Image[];
  external?: { uri: string; title: string; description: string };
  quoteHref?: string;
  replyHref?: string;
  domain?: {
    name: string;
    href: string;
    status: string | null;
    verifiedHandle: string | null;
  };
  tangled?: TangledCard;
};

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

function date(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
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

export async function getTimeline() {
  const [posts, statuses, states, domains, tangled] = await Promise.all([
    listRecords<AppBskyFeedPost.Record>("app.bsky.feed.post"),
    listRecords<NowRecord>("is.braxton.now", 30, 60_000),
    listRecords<StateRecord>("is.braxton.state", 30, 60_000),
    listAllRecords<DomainRecord>("at.marque.domain"),
    getTangledTimeline(),
  ]);
  const entries: TimelineEntry[] = [];
  const linkedStates = new Set<string>();
  const stateByUri = new Map(
    (states ?? []).map((record) => [record.uri, record.value]),
  );
  const nowEntries = await Promise.all(
    (statuses ?? []).map(async ({ uri, value }) => {
      const createdAt = date(value.createdAt);
      if (
        !createdAt ||
        typeof value.status !== "string" ||
        !value.status.trim()
      )
        return null;
      const stateUri = value.stateRef?.uri;
      const state =
        stateUri && stateByUri.has(stateUri)
          ? parseState(stateByUri.get(stateUri)!)
          : await getStateFromRef(value.stateRef);
      if (stateUri && state) linkedStates.add(stateUri);
      return {
        uri,
        kind: "now" as const,
        createdAt,
        href: `https://aturi.to/explore/${DID}/is.braxton.now/${encodeURIComponent(uri.split("/").at(-1)!)}`,
        text: [{ text: value.status.trim() }],
        state,
        images: [],
      };
    }),
  );
  for (const entry of nowEntries) if (entry) entries.push(entry);
  for (const { uri, value } of states ?? []) {
    const createdAt = date(value.createdAt);
    const state = parseState(value);
    if (!createdAt || !state || linkedStates.has(uri)) continue;
    entries.push({
      uri,
      kind: "state",
      createdAt,
      href: `https://aturi.to/explore/${DID}/is.braxton.state/${encodeURIComponent(uri.split("/").at(-1)!)}`,
      text: [],
      state,
      images: [],
    });
  }
  for (const { uri, value } of posts ?? []) {
    const createdAt = date(value.createdAt);
    const href = postUrl(uri);
    if (!createdAt || !href || typeof value.text !== "string") continue;
    entries.push({
      uri,
      kind: "post",
      createdAt,
      href,
      text: postText(value),
      state: null,
      replyHref: value.reply ? postUrl(value.reply.parent.uri) : undefined,
      ...postMedia(value),
    });
  }
  for (const { uri, value } of domains ?? []) {
    const createdAt = date(value.createdAt);
    const name =
      typeof value.domain === "string" ? value.domain.trim().toLowerCase() : "";
    // A domain must be a hostname, with no URL path, credentials, or port.
    if (
      !createdAt ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        name,
      )
    )
      continue;
    entries.push({
      uri,
      kind: "domain",
      createdAt,
      href: `https://aturi.to/explore/${uri}`,
      text: [],
      state: null,
      images: [],
      domain: {
        name,
        href: `https://${name}/`,
        status: typeof value.status === "string" ? value.status : null,
        verifiedHandle:
          value.atprotoVerified === true &&
          typeof value.atprotoHandle === "string"
            ? value.atprotoHandle
            : null,
      },
    });
  }
  for (const card of tangled.cards) {
    entries.push({
      // Daily activity has no record of its own. Explore a ticket when present,
      // otherwise the repository manifest that backs the card.
      uri:
        card.items.find((item) => item.kind === "pull")?.id ??
        `at://${card.repo.did}/org.tangled.repo.manifest/self`,
      kind: card.kind,
      createdAt: card.createdAt,
      href: card.repo.href,
      text: [],
      state: null,
      images: [],
      tangled: card,
    });
  }
  return {
    entries: entries.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    ),
    unavailable:
      tangled.unavailable ||
      [posts, statuses, states, domains].some((records) => records === null),
  };
}
