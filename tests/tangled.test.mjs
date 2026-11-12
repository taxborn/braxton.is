import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Node strips TypeScript; resolve the extensionless imports used by Astro.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes("/src/lib/") &&
      /^\.\/[\w-]+$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { groupTangledActivity, getTangledTimeline } =
  await import("../src/lib/tangled.ts");
const { DID } = await import("../src/lib/atproto.ts");
const repo = {
  did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
  name: "example",
  href: "https://tangled.org/braxton.is/example",
};
const event = (id, minutes, kind = "commit") => ({
  id,
  kind,
  createdAt: new Date(Date.UTC(2026, 10, 12, 12, minutes)),
  title: id,
  href: `${repo.href}/commit/${id}`,
  detail: id,
});

test("ten consecutive commits form one expandable group, newest first", () => {
  const cards = groupTangledActivity(
    repo,
    Array.from({ length: 10 }, (_, i) => event(String(i), i * 5)),
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].items.length, 10);
  assert.equal(cards[0].items[0].id, "9");
  assert.equal(cards[0].createdAt.toISOString(), "2026-11-12T12:45:00.000Z");
});

const eventAt = (id, timestamp) => ({
  ...event(id, 0),
  createdAt: new Date(timestamp),
});

test("activity hours apart on one Central calendar day forms one group across UTC midnight", () => {
  const cards = groupTangledActivity(repo, [
    eventAt("morning", "2026-11-11T06:00:00Z"),
    eventAt("evening", "2026-11-12T05:59:59Z"),
  ]);
  assert.equal(cards.length, 1);
  assert.deepEqual(
    cards[0].items.map((item) => item.id),
    ["evening", "morning"],
  );
  assert.equal(cards[0].createdAt.toISOString(), "2026-11-12T05:59:59.000Z");
});

test("Central midnight starts a new group even for activity one second apart", () => {
  for (const [before, after] of [
    ["2026-11-12T05:59:59Z", "2026-11-12T06:00:00Z"],
    ["2026-07-12T04:59:59Z", "2026-07-12T05:00:00Z"],
  ]) {
    const cards = groupTangledActivity(repo, [
      eventAt("before", before),
      eventAt("after", after),
    ]);
    assert.equal(cards.length, 2);
    assert.deepEqual(
      cards.map((card) => card.items[0].id),
      ["after", "before"],
    );
  }
});

test("groups combine PRs and commits, deduplicate history, and omit invalid dates", () => {
  const items = [
    event("commit", 0),
    event("pr", 5, "pull"),
    event("commit", 0),
    { ...event("bad", 0), createdAt: new Date(NaN) },
  ];
  const cards = groupTangledActivity(repo, items);
  assert.equal(cards.length, 1);
  assert.deepEqual(
    cards[0].items.map((item) => item.kind),
    ["pull", "commit"],
  );
  assert.deepEqual(groupTangledActivity(repo, []), []);
});

test("loads repo creations, branch commits and authored PRs; one failed knot preserves other cards", async (t) => {
  const brokenDid = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
  const externalDid = "did:plc:cccccccccccccccccccccccc";
  const ticketUri = `at://${repo.did}/org.tangled.track.ticket/1`;
  const externalUri = `at://${externalDid}/org.tangled.track.ticket/2`;
  const hash = (i) => i.toString(16).padStart(40, "0");
  const commits = Array.from({ length: 10 }, (_, i) => ({
    hash: hash(i + 1),
    message: `Commit ${i}\n\nBody`,
    author: {
      name: "Braxton",
      when: event(String(i), i * 5).createdAt.toISOString(),
    },
  }));
  const record = (did, collection, key, value) => ({
    uri: `at://${did}/${collection}/${key}`,
    cid: "cid",
    value,
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname === "plc.directory")
      return Response.json({
        service: [
          {
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://test-knot.example",
          },
        ],
      });
    const method = url.pathname.split("/").at(-1);
    const did = url.searchParams.get("repo");
    const collection = url.searchParams.get("collection");
    if (method === "com.atproto.repo.listRecords")
      return Response.json({
        records: [
          record(DID, collection, "example", {
            repo: repo.did,
            createdAt: "2026-11-09T12:00:00Z",
          }),
          record(DID, collection, "broken", {
            repo: brokenDid,
            createdAt: "2026-11-09T12:01:00Z",
          }),
        ],
      });
    if (method === "org.tangled.actor.getProfileActivity") {
      const pull = {
        uri: ticketUri,
        repo: { did: repo.did, name: "example", ownerDid: DID },
      };
      return Response.json({
        truncated: false,
        months: [
          {
            pulls: [
              pull,
              pull,
              {
                uri: externalUri,
                repo: {
                  did: externalDid,
                  name: "other",
                  ownerDid: brokenDid,
                  ownerHandle: "someone.test",
                },
              },
            ],
          },
        ],
      });
    }
    if (did === brokenDid) return new Response("", { status: 503 });
    if (method === "com.atproto.repo.getRecord") {
      if (collection === "org.tangled.repo.manifest")
        return Response.json({
          value: {
            description: "A repository",
            declaration: { owner: DID, name: "example" },
          },
        });
      if (collection === "org.tangled.git.refs")
        return Response.json({
          value: {
            refs: {
              $bytes: Buffer.from(
                `${hash(1)} refs/heads/main\n${hash(2)} refs/heads/feature\n`,
              ).toString("base64"),
            },
          },
        });
      if (collection === "org.tangled.track.ticket")
        return Response.json({
          value: {
            createdAt: "2026-11-12T12:20:00Z",
            targetBranch: "main",
            title: { text: "Add a feature" },
            state: "completed",
          },
        });
    }
    if (method === "org.tangled.git.listCommits")
      return Response.json({
        commits:
          url.searchParams.get("ref") === hash(1)
            ? commits
            : [
                ...commits,
                {
                  hash: hash(11),
                  message: "Unmerged work",
                  author: { name: "Braxton", when: "2026-11-12T12:50:00Z" },
                },
              ],
      });
    throw new Error(`Unexpected request ${url}`);
  });
  // Expected source failures are asserted below; keep test output readable.
  t.mock.method(console, "error", () => {});
  const result = await getTangledTimeline();
  assert.equal(result.unavailable, true);
  assert.equal(result.cards.filter((card) => card.kind === "repo").length, 2);
  const ownGroup = result.cards.find(
    (card) => card.kind === "activity" && card.repo.did === repo.did,
  );
  assert.equal(
    ownGroup.items.filter((item) => item.kind === "commit").length,
    11,
  );
  assert.equal(ownGroup.items.filter((item) => item.kind === "pull").length, 1);
  assert.equal(ownGroup.items[0].title, "Unmerged work");
  assert.match(
    ownGroup.items.find((item) => item.kind === "pull").href,
    /\/pulls\/1$/,
  );
  assert.match(
    ownGroup.items.find((item) => item.kind === "pull").detail,
    /merged/,
  );
  const external = result.cards.find((card) => card.repo.did === externalDid);
  assert.equal(external.items.length, 1);
  assert.match(external.items[0].href, /someone.test\/other\/pulls\/2$/);
  assert.equal(
    requests.filter((url) =>
      url.pathname.endsWith("org.tangled.git.listCommits"),
    ).length,
    2,
  );
});
