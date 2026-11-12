import { DID, getLatestRecord, getRecord } from "./atproto";
import { parseDate } from "./format";

// Short, so a status posted from the Shortcut shows up within a minute.
const TTL_MS = 60 * 1000;

/** A reading from an is.braxton.state record (see lexicons/STATE.md). */
export type State = {
  heartRate: number | null;
  activity: string | null;
  batteryLevel: number | null;
};

export type Now = {
  status: string;
  createdAt: Date | null;
  /** The reading taken with this status, if it has one. */
  state: State | null;
};

type NowRecord = { status?: unknown; createdAt?: unknown; stateRef?: unknown };

/** The latest is.braxton.now record (see lexicons/NOW.md), or null if none. */
export async function getNow(): Promise<Now | null> {
  const record = await getLatestRecord<NowRecord>("is.braxton.now", TTL_MS);
  const status = typeof record?.status === "string" ? record.status.trim() : "";
  if (!status) return null;

  return {
    status,
    createdAt: parseDate(record?.createdAt),
    state: await getStateFromRef(record?.stateRef),
  };
}

/**
 * Follow a stateRef to its is.braxton.state record. Only refs into my own repo
 * are followed. The cid is not checked: state records are never edited.
 */
export async function getStateFromRef(ref: unknown): Promise<State | null> {
  const uri = (ref as { uri?: unknown } | null)?.uri;
  if (typeof uri !== "string") return null;
  const [, repo, collection, rkey] =
    uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/) ?? [];
  if (repo !== DID || collection !== "is.braxton.state") return null;

  return parseState(await getRecord(collection, rkey));
}

/**
 * Read the fields of a state record, dropping any that are missing or out of
 * range. Shortcuts sometimes writes numbers as strings, so both are accepted.
 * Returns null when no field survives.
 */
export function parseState(
  record: Record<string, unknown> | null,
): State | null {
  if (!record) return null;

  const activity =
    typeof record.activity === "string"
      ? record.activity.trim().toLowerCase()
      : "";
  const state: State = {
    // A Shortcut with no heart-rate sample writes 0, so 0 counts as missing.
    heartRate: toInt(record.heartRate, 1, 300),
    activity:
      activity && activity !== "unknown" && activity.length <= 64
        ? activity
        : null,
    batteryLevel: toInt(record.batteryLevel, 0, 100),
  };
  return Object.values(state).some((v) => v !== null) ? state : null;
}

function toInt(value: unknown, min: number, max: number): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  const rounded = Math.round(n);
  return rounded >= min && rounded <= max ? rounded : null;
}
