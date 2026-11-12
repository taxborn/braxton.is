// Publishes lexicons/*.json to my repo as com.atproto.lexicon.schema records,
// so other software can look the schemas up by NSID.
//
//   node publish-lexicons.js --check    compare, change nothing, no password
//   node publish-lexicons.js            write the records that differ
//
// Publishing signs in with ATPROTO_APP_PASSWORD. See "Lexicons" in the README.
import { resolveTxt } from "node:dns/promises";
import { readdir, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { AtpAgent } from "@atproto/api";

const PDS = "https://pds.biscuits.at";
const DID = "did:plc:2grdruc2p6fjhksrfpt366yl";
const COLLECTION = "com.atproto.lexicon.schema";
const DIR = new URL("./lexicons/", import.meta.url);

const checkOnly = process.argv.includes("--check");
const agent = new AtpAgent({ service: PDS });

/** Every lexicons/*.json file as the record to publish, keyed by its NSID. */
async function loadLocal() {
  const records = new Map();
  for (const file of (await readdir(DIR)).sort()) {
    if (!file.endsWith(".json")) continue;
    const schema = JSON.parse(await readFile(new URL(file, DIR), "utf8"));
    if (`${schema.id}.json` !== file) {
      throw new Error(`${file} declares the id ${schema.id}`);
    }
    records.set(schema.id, { $type: COLLECTION, ...schema });
  }
  return records;
}

/** The published record for an NSID, or null if there is none. */
async function getPublished(nsid) {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: DID,
      collection: COLLECTION,
      rkey: nsid,
    });
    return res.data.value;
  } catch (err) {
    if (err.error === "RecordNotFound") return null;
    throw err;
  }
}

/**
 * Resolvers find the repo for is.braxton.now through a TXT record at
 * _lexicon.braxton.is: the NSID without its last segment, reversed.
 */
async function pointsHere(nsid) {
  const name = `_lexicon.${nsid.split(".").slice(0, -1).reverse().join(".")}`;
  const answers = await resolveTxt(name).catch(() => []);
  return {
    name,
    ok: answers.some((chunks) => chunks.join("") === `did=${DID}`),
  };
}

const local = await loadLocal();
let problems = 0;

const stale = [];
for (const [nsid, record] of local) {
  const published = await getPublished(nsid);
  if (isDeepStrictEqual(published, record)) {
    console.log(`${nsid}: up to date`);
  } else {
    console.log(
      `${nsid}: ${published ? "differs from" : "missing from"} the PDS`,
    );
    stale.push(nsid);
  }

  const dns = await pointsHere(nsid);
  if (!dns.ok) {
    console.log(`${nsid}: no TXT record ${dns.name} with the value did=${DID}`);
    problems++;
  }
}

if (checkOnly) {
  process.exit(stale.length + problems > 0 ? 1 : 0);
}

if (stale.length > 0) {
  if (!process.env.ATPROTO_APP_PASSWORD) {
    throw new Error("Set ATPROTO_APP_PASSWORD to publish.");
  }
  await agent.login({
    identifier: DID,
    password: process.env.ATPROTO_APP_PASSWORD,
  });
  for (const nsid of stale) {
    // The repo is the DID: this PDS rejects a handle here.
    await agent.com.atproto.repo.putRecord({
      repo: DID,
      collection: COLLECTION,
      rkey: nsid,
      record: local.get(nsid),
    });
    console.log(`${nsid}: published`);
  }
}

// A missing TXT record leaves the schemas published but not findable.
process.exit(problems > 0 ? 1 : 0);
