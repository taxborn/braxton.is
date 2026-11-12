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
const { domainEntries, postEntries, stateEntries } =
  await import("../src/lib/timeline.ts");
const { DID } = await import("../src/lib/atproto.ts");

const createdAt = "2026-01-02T03:04:05.000Z";
const record = (collection, rkey, value) => ({
  uri: `at://${DID}/${collection}/${rkey}`,
  cid: "cid",
  value,
});

test("posts link to Bluesky and carry their reply parent", () => {
  const [post, ...rest] = postEntries([
    record("app.bsky.feed.post", "3abc", {
      text: "hello",
      createdAt,
      reply: { parent: { uri: `at://${DID}/app.bsky.feed.post/3parent` } },
    }),
    record("app.bsky.feed.post", "3bad", { text: "no date" }),
  ]);
  assert.equal(rest.length, 0);
  assert.equal(post.kind, "post");
  assert.equal(post.href, `https://bsky.app/profile/${DID}/post/3abc`);
  assert.equal(post.replyHref, `https://bsky.app/profile/${DID}/post/3parent`);
  assert.deepEqual(post.text, [{ text: "hello" }]);
  assert.deepEqual(post.images, []);
});

test("state readings already shown with a status are skipped", () => {
  const states = [
    record("is.braxton.state", "3one", { heartRate: 61, createdAt }),
    record("is.braxton.state", "3two", { heartRate: 72, createdAt }),
    record("is.braxton.state", "3empty", { heartRate: 0, createdAt }),
  ];
  const entries = stateEntries(states, new Set([states[0].uri]));
  assert.deepEqual(
    entries.map((entry) => [entry.uri, entry.state.heartRate]),
    [[states[1].uri, 72]],
  );
});

test("domains must be bare hostnames", () => {
  const entries = domainEntries([
    record("at.marque.domain", "a", {
      domain: " Example.COM ",
      createdAt,
      status: "active",
      atprotoVerified: true,
      atprotoHandle: "example.com",
    }),
    record("at.marque.domain", "b", { domain: "evil.com/path", createdAt }),
    record("at.marque.domain", "c", { domain: "user@evil.com", createdAt }),
    record("at.marque.domain", "d", { domain: "example.org" }),
  ]);
  assert.equal(entries.length, 1);
  assert.deepEqual(
    { ...entries[0], createdAt: undefined, uri: undefined },
    {
      uri: undefined,
      kind: "domain",
      createdAt: undefined,
      name: "example.com",
      href: "https://example.com/",
      status: "active",
      verifiedHandle: "example.com",
    },
  );
});
