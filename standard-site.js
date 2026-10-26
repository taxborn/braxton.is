import { AtpAgent } from "@atproto/api";

// Initialise the agent (use your specific PDS if not on Bluesky)
const agent = new AtpAgent({ service: "https://pds.biscuits.at" });

async function createPublicationRecord() {
  // 1. Authenticate (Always use an App Password, never your main password)
  await agent.login({
    identifier: "braxton.is",
    password: process.env.ATPROTO_APP_PASSWORD,
  });

  const did = agent.session.did;

  // 2. Define the Publication Record
  const publicationRecord = {
    $type: "site.standard.publication",
    url: "https://braxton.is",
    name: "braxton's digital garden",
  };

  // 3. Write the record to your repository
  try {
    const response = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: "site.standard.publication",
      record: publicationRecord,
    });

    console.log("Publication record created!");
    console.log("Your AT-URI is:", response.data.uri);
  } catch (error) {
    console.error("Failed to create publication:", error);
  }
}

createPublicationRecord();
