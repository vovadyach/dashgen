import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAwsDynamo, ecsCredentials } from "../../src/dynamo.ts";

describe("createAwsDynamo", () => {
  it("reaches AWS's own DynamoDB in the region, with no retry, like the client for DynamoDB Local", async () => {
    const client = createAwsDynamo("us-east-1");
    try {
      assert.equal(await client.config.region(), "us-east-1");
      assert.equal(client.config.isCustomEndpoint, false);
      // A retry after a lost reply would count one question twice.
      assert.equal(await client.config.maxAttempts(), 1);
    } finally {
      client.destroy();
    }
  });
});

describe("ecsCredentials", () => {
  it("fails outside an ECS task, instead of signing with a developer's own credentials", async () => {
    await assert.rejects(
      ecsCredentials({ env: { AWS_PROFILE: "default" } })(),
      /AWS_CONTAINER_CREDENTIALS_RELATIVE_URI isn't set/,
    );
  });
});
