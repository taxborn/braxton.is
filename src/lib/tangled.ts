import { cached, DID, failureReason, listAllRecords, query } from "./atproto";
import { parseDate, TIME_ZONE } from "./format";

const TTL_MS = 5 * 60_000;
const activityDay = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TIME_ZONE,
});
const BOBBIN = "https://api.tangled.org";

type Repo = { did: string; name: string; href: string; description?: string };
export type TangledItem = {
  id: string;
  kind: "commit" | "pull";
  createdAt: Date;
  title: string;
  href: string;
  detail: string;
};
export type TangledCard = {
  id: string;
  kind: "repo" | "activity";
  createdAt: Date;
  repo: Repo;
  items: TangledItem[];
};
type Declaration = { repo?: string; createdAt?: string };
type RepoView = {
  did: string;
  name: string;
  ownerDid: string;
  ownerHandle?: string;
};
type ProfileActivity = {
  months: { pulls: { uri: string; repo: RepoView }[] }[];
  truncated: boolean;
};
type Ticket = {
  createdAt?: string;
  targetBranch?: string;
  title?: { text?: string };
  state?: string;
};
type Commit = {
  hash: string;
  message: string;
  author: { name: string; when: string };
};

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function repoUrl(owner: string, name: string): string {
  return `https://tangled.org/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** Resolve each repository's own PDS rather than assuming it uses my knot. */
async function getKnot(did: string): Promise<string | null> {
  if (!/^did:plc:[a-z2-7]{24}$/.test(did)) return null;
  return cached(`tangled/identity/${did}`, TTL_MS, async () => {
    const response = await fetch(`https://plc.directory/${did}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok)
      throw new Error(`Repo identity returned ${response.status}`);
    const doc = (await response.json()) as {
      service?: { id: string; type: string; serviceEndpoint: string }[];
    };
    const endpoint = doc.service?.find(
      (service) => service.type === "AtprotoPersonalDataServer",
    )?.serviceEndpoint;
    if (!endpoint || new URL(endpoint).protocol !== "https:")
      throw new Error("Repo has no HTTPS knot");
    return endpoint.replace(/\/$/, "");
  });
}

async function readRecord<T>(
  did: string,
  collection: string,
  rkey: string,
): Promise<T | null> {
  return cached(
    `tangled/record/${did}/${collection}/${rkey}`,
    TTL_MS,
    async () => {
      const knot = await getKnot(did);
      if (!knot) throw new Error(`Could not resolve repository ${did}`);
      const record = await query<{ value: T }>(
        "com.atproto.repo.getRecord",
        { repo: did, collection, rkey },
        knot,
      );
      return record.value;
    },
  );
}

/** Read branch tips, deduplicate shared history, then retain the latest 50. */
async function getCommits(did: string) {
  return cached(`tangled/commits/${did}`, TTL_MS, async () => {
    const knot = await getKnot(did);
    if (!knot) throw new Error(`Could not resolve repository ${did}`);
    const refs = await readRecord<{ refs: { $bytes: string } }>(
      did,
      "org.tangled.git.refs",
      "self",
    );
    if (!refs) throw new Error(`Could not read branches for ${did}`);
    const tips = [
      ...new Set(
        atob(refs.refs.$bytes)
          .split("\n")
          .map((line) => line.match(/^([a-f0-9]{40,64}) refs\/heads\/.+$/)?.[1])
          .filter((tip): tip is string => Boolean(tip)),
      ),
    ];
    const commits: Commit[] = [];
    let unavailable = false;
    let successful = 0;
    let firstFailure: unknown;
    // Limit simultaneous history requests for repos with many branches.
    for (let i = 0; i < tips.length; i += 4) {
      const results = await Promise.allSettled(
        tips
          .slice(i, i + 4)
          .map((ref) =>
            query<{ commits: Commit[] }>(
              "org.tangled.git.listCommits",
              { repo: did, ref, limit: "50" },
              knot,
            ),
          ),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          commits.push(...result.value.commits);
          successful++;
        } else {
          unavailable = true;
          firstFailure ??= result.reason;
        }
      }
    }
    if (tips.length > 0 && successful === 0)
      throw new Error(`Could not read commits for ${did}`, {
        cause: firstFailure,
      });
    return {
      commits: [
        ...new Map(commits.map((commit) => [commit.hash, commit])).values(),
      ]
        .filter((commit) => parseDate(commit.author?.when))
        .sort((a, b) => Date.parse(b.author.when) - Date.parse(a.author.when))
        .slice(0, 50),
      unavailable,
      failure: unavailable ? describe(firstFailure) : undefined,
    };
  });
}

/** Group each repo's activity by calendar day in the timeline's Central time. */
export function groupTangledActivity(
  repo: Repo,
  items: TangledItem[],
): TangledCard[] {
  const sorted = [...new Map(items.map((item) => [item.id, item])).values()]
    .filter((item) => !Number.isNaN(item.createdAt.getTime()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const cards: TangledCard[] = [];
  for (const item of sorted) {
    const previous = cards.at(-1);
    if (
      !previous ||
      activityDay.format(previous.createdAt) !==
        activityDay.format(item.createdAt)
    ) {
      cards.push({
        id: `tangled:${repo.did}:${item.id}`,
        kind: "activity",
        createdAt: item.createdAt,
        repo,
        items: [item],
      });
    } else {
      previous.items.push(item);
    }
  }
  return cards;
}

export async function getTangledTimeline(): Promise<{
  cards: TangledCard[];
  unavailable: boolean;
  /** One line per source that could not be fully read. */
  missing: string[];
}> {
  const missing: string[] = [];
  const [declarations, profile] = await Promise.all([
    listAllRecords<Declaration>("org.tangled.repo.declaration"),
    cached("tangled/profile-activity", TTL_MS, () =>
      query<ProfileActivity>(
        "org.tangled.actor.getProfileActivity",
        { actor: DID, months: "3" },
        BOBBIN,
      ),
    ),
  ]);
  if (declarations === null)
    missing.push(
      `repo declarations: ${failureReason("org.tangled.repo.declaration/all")}`,
    );
  if (profile === null)
    missing.push(
      `profile activity: ${failureReason("tangled/profile-activity")}`,
    );
  if (profile?.truncated) missing.push("profile activity: truncated");
  const repos = new Map<
    string,
    { repo: Repo; createdAt?: Date; owned: boolean }
  >();
  for (const { uri, value } of declarations ?? []) {
    if (typeof value.repo !== "string") continue;
    const name = uri.split("/").at(-1)!;
    repos.set(value.repo, {
      repo: { did: value.repo, name, href: repoUrl(DID, name) },
      createdAt: parseDate(value.createdAt) ?? undefined,
      owned: true,
    });
  }
  const pulls = new Map<string, { uri: string; repo: RepoView }>();
  for (const month of profile?.months ?? []) {
    for (const pull of month.pulls) {
      pulls.set(pull.uri, pull);
      if (!repos.has(pull.repo.did)) {
        repos.set(pull.repo.did, {
          repo: {
            did: pull.repo.did,
            name: pull.repo.name,
            href: repoUrl(
              pull.repo.ownerHandle ?? pull.repo.ownerDid,
              pull.repo.name,
            ),
          },
          owned: false,
        });
      }
    }
  }
  const cards = await Promise.all(
    [...repos.values()].map(async ({ repo, createdAt, owned }) => {
      const repoCards: TangledCard[] = [];
      const items: TangledItem[] = [];
      const [manifest, commits, tickets] = await Promise.all([
        owned
          ? readRecord<{
              description?: string;
              declaration?: { owner: string; name: string };
            }>(repo.did, "org.tangled.repo.manifest", "self")
          : null,
        owned ? getCommits(repo.did) : null,
        Promise.all(
          [...pulls.values()]
            .filter((pull) => pull.repo.did === repo.did)
            .map(async (pull) => {
              const match = pull.uri.match(
                /^at:\/\/([^/]+)\/org\.tangled\.track\.ticket\/([^/]+)$/,
              );
              if (!match || match[1] !== repo.did) return null;
              const ticket = await readRecord<Ticket>(
                repo.did,
                "org.tangled.track.ticket",
                match[2],
              );
              if (!ticket)
                missing.push(
                  `${repo.name} ticket ${match[2]}: ${failureReason(`tangled/record/${repo.did}/org.tangled.track.ticket/${match[2]}`)}`,
                );
              return { ticket, key: match[2], uri: pull.uri };
            }),
        ),
      ]);
      if (owned && !manifest)
        missing.push(
          `${repo.name} manifest: ${failureReason(`tangled/record/${repo.did}/org.tangled.repo.manifest/self`)}`,
        );
      if (owned && !commits)
        missing.push(
          `${repo.name} commits: ${failureReason(`tangled/commits/${repo.did}`)}`,
        );
      if (commits?.unavailable)
        missing.push(`${repo.name} some branches: ${commits.failure}`);
      if (manifest?.declaration?.owner === DID) {
        repo.name = manifest.declaration.name;
        repo.href = repoUrl(DID, repo.name);
      }
      if (typeof manifest?.description === "string")
        repo.description = manifest.description;
      if (owned && createdAt)
        repoCards.push({
          id: `tangled:repo:${repo.did}`,
          kind: "repo",
          createdAt,
          repo,
          items: [],
        });
      for (const commit of commits?.commits ?? []) {
        const date = parseDate(commit.author?.when);
        if (
          !date ||
          !/^[a-f0-9]{40,64}$/.test(commit.hash) ||
          typeof commit.message !== "string"
        )
          continue;
        items.push({
          id: commit.hash,
          kind: "commit",
          createdAt: date,
          title: commit.message.split("\n")[0] || commit.hash.slice(0, 8),
          href: `${repo.href}/commit/${commit.hash}`,
          detail: `${commit.hash.slice(0, 8)} · ${commit.author.name}`,
        });
      }
      for (const result of tickets) {
        const ticket = result?.ticket;
        const date = parseDate(ticket?.createdAt);
        if (
          !result ||
          !ticket?.targetBranch ||
          !date ||
          typeof ticket.title?.text !== "string"
        )
          continue;
        items.push({
          id: result.uri,
          kind: "pull",
          createdAt: date,
          title: ticket.title.text,
          href: `${repo.href}/pulls/${encodeURIComponent(result.key)}`,
          detail: `#${result.key} · ${ticket.state === "completed" ? "merged" : (ticket.state ?? "open")}`,
        });
      }
      return [...repoCards, ...groupTangledActivity(repo, items)];
    }),
  );
  return { cards: cards.flat(), unavailable: missing.length > 0, missing };
}
