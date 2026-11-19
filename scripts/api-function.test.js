import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { URL } from "node:url";
import vm from "node:vm";

// CloudFront's API function (infra/aws/always-on/functions/api.js), run here
// with a fake of CloudFront's own module, whose key-value store holds `entry`
// as the session's, or nothing.
const source = readFileSync(
  new URL("../infra/aws/always-on/functions/api.js", import.meta.url),
  "utf8",
).replace('import cf from "cloudfront";', "");

function loadFunction(entry) {
  const origins = [];
  const cf = {
    kvs: () => ({
      exists: (key) =>
        Promise.resolve(key === "session" && entry !== undefined),
      get: () => Promise.resolve(entry),
    }),
    updateRequestOrigin: (origin) => {
      origins.push(origin);
    },
  };
  const context = vm.createContext({ cf });
  vm.runInContext(source, context);
  // Objects from the function have its own realm's prototypes, so a copy is
  // what the assertions compare.
  return {
    handler: context.handler,
    origins: () => JSON.parse(JSON.stringify(origins)),
  };
}

const event = (method, uri, headers = {}) => ({
  viewer: { ip: "198.51.100.10" },
  request: { method, uri, headers, querystring: {}, cookies: {} },
});

const SESSION = {
  loadBalancer: "dashgen-1.us-east-1.elb.amazonaws.com",
  secret: "the-secret",
};

describe("CloudFront's API function", () => {
  it("answers offline itself between sessions", async () => {
    const { handler, origins } = loadFunction(undefined);

    const answer = await handler(event("GET", "/api/health"));

    assert.equal(answer.statusCode, 503);
    assert.deepEqual(JSON.parse(answer.body), { status: "offline" });
    assert.deepEqual(origins(), []);
  });

  it("sends a request to the session's load balancer, with the secret and the visitor's own IP, never a visitor's copies", async () => {
    const { handler, origins } = loadFunction(SESSION);

    const forwarded = await handler(
      event("POST", "/api/ask", {
        "x-origin-verify": { value: "forged" },
        "x-viewer-ip": { value: "203.0.113.66" },
        "content-type": { value: "application/json" },
      }),
    );

    assert.deepEqual(Object.keys(forwarded.headers), ["content-type"]);
    assert.deepEqual(origins(), [
      {
        domainName: SESSION.loadBalancer,
        customHeaders: {
          "x-origin-verify": "the-secret",
          "x-viewer-ip": "198.51.100.10",
        },
      },
    ]);
  });

  it("lets only the streams of runs already started through while the session closes", async () => {
    const { handler, origins } = loadFunction({ ...SESSION, closing: true });

    for (const [method, uri] of [
      ["POST", "/api/ask"],
      ["GET", "/api/health"],
      ["GET", "/api/runs/abc/events/more"],
    ]) {
      const answer = await handler(event(method, uri));
      assert.equal(answer.statusCode, 503, `${method} ${uri}`);
    }
    assert.deepEqual(origins(), []);

    const stream = await handler(
      event("GET", "/api/runs/0196f6c4-aaaa-7bbb-8ccc-123456789abc/events"),
    );
    // A request on its way, not an answer.
    assert.equal(stream.statusCode, undefined);
    assert.equal(origins().length, 1);
  });
});
