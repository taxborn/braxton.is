import { getLatestRecord } from "./atproto";

const TTL_MS = 60 * 1000;
const RECENT_PLAY_MS = 15 * 60 * 1000;

type PlayRecord = {
  trackName?: unknown;
  artists?: { artistName?: unknown }[];
  playedTime?: unknown;
  originUri?: unknown;
};

export async function getNowPlaying() {
  const record = await getLatestRecord<PlayRecord>("fm.teal.feed.play", TTL_MS);
  const track = typeof record?.trackName === "string" ? record.trackName.trim() : "";
  const playedAt = Date.parse(
    typeof record?.playedTime === "string" ? record.playedTime : "",
  );
  const age = Date.now() - playedAt;
  // Check freshness after the cached read, including stale reads during outages.
  if (!track || !Number.isFinite(age) || age < 0 || age >= RECENT_PLAY_MS)
    return null;

  const artists = Array.isArray(record?.artists)
    ? record.artists.flatMap((artist) =>
        typeof artist?.artistName === "string" && artist.artistName.trim()
          ? [artist.artistName.trim()]
          : [],
      )
    : [];

  let url: string | null = null;
  if (typeof record?.originUri === "string") {
    try {
      const origin = new URL(record.originUri);
      if (origin.protocol === "https:" || origin.protocol === "http:")
        url = origin.href;
    } catch {
      // A play without a web URL can still show its track and artists.
    }
  }

  return { track, artists, url };
}
