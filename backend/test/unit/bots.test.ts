import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBotCheck, SITEVERIFY_URL } from "../../src/bots/index.ts";
import { Secret } from "../../src/config.ts";
import { type Answer, fakeFetch } from "../helpers/fetch.ts";
import { recordingLogger } from "../helpers/logger.ts";

const SECRET = new Secret("turnstile-secret");
const TOKEN = "a-turnstile-token";
const IP = "203.0.113.7";
const PASSED = { success: true, "error-codes": [] };

/** Cloudflare's verdict: turned down, for these reasons. */
const turnedDown = (...codes: string[]) => ({
  success: false,
  "error-codes": codes,
});

/** Checks TOKEN against Cloudflare's `answer`, and returns the verdict and what was logged. */
async function checkWith(answer: Answer) {
  const { fetch } = fakeFetch(PASSED, [answer]);
  const { log, lines } = recordingLogger();
  const verdict = await createBotCheck(SECRET, { fetch, timeoutMs: 10 }).check(
    TOKEN,
    IP,
    log,
  );
  return { verdict, lines };
}

describe("createBotCheck", () => {
  it("asks Cloudflare about the token, with the secret key and the visitor's IP", async () => {
    const { fetch, urls, bodies } = fakeFetch(PASSED, []);
    const { log } = recordingLogger();

    assert.equal(
      await createBotCheck(SECRET, { fetch }).check(TOKEN, IP, log),
      "passed",
    );
    assert.deepEqual(urls, [SITEVERIFY_URL]);
    assert.deepEqual(bodies, [
      { secret: "turnstile-secret", response: TOKEN, remoteip: IP },
    ]);
  });

  it("fails a token Cloudflare turns down, whatever the HTTP status, and logs why, never the token", async () => {
    for (const status of [200, 400]) {
      const { verdict, lines } = await checkWith({
        status,
        body: turnedDown("timeout-or-duplicate"),
      });

      assert.equal(verdict, "failed");
      assert.deepEqual(lines, [
        {
          level: "info",
          obj: { errors: ["timeout-or-duplicate"] },
          msg: "bot check failed",
        },
      ]);
    }
  });

  it("fails a question without a token, without asking Cloudflare", async () => {
    const { fetch, urls } = fakeFetch(PASSED, []);
    const { log, lines } = recordingLogger();
    const bots = createBotCheck(SECRET, { fetch });

    assert.equal(await bots.check(undefined, IP, log), "failed");
    assert.equal(await bots.check("", IP, log), "failed");
    assert.equal(urls.length, 0);
    assert.deepEqual(lines[0]?.obj, { errors: ["missing-input-response"] });
  });

  it("calls the setup wrong, and logs an error, for a wrong secret key, whatever the HTTP status", async () => {
    // Cloudflare's answer to a mistyped key, or to Terraform's placeholder.
    for (const status of [400, 200]) {
      const { verdict, lines } = await checkWith({
        status,
        body: turnedDown("invalid-input-secret"),
      });

      assert.equal(verdict, "misconfigured");
      assert.deepEqual(lines, [
        {
          level: "error",
          obj: { errors: ["invalid-input-secret"] },
          msg: "bot check misconfigured",
        },
      ]);
    }
  });

  it("calls the setup wrong for an answer that isn't a verdict and doesn't mean Cloudflare is down", async () => {
    const answers: Answer[] = [
      { status: 404, text: "<html>Not found</html>", type: "text/html" },
      { status: 200, body: { unexpected: true } },
    ];
    for (const answer of answers) {
      const { verdict, lines } = await checkWith(answer);

      assert.equal(verdict, "misconfigured");
      assert.equal(lines[0]?.level, "error");
    }
  });

  it("calls the setup wrong when a 4xx stops partway, since it turned the request down, maybe for a wrong secret key", async () => {
    const { verdict, lines } = await checkWith({ status: 400, cutOff: true });

    assert.equal(verdict, "misconfigured");
    assert.equal(lines.length, 1);
    const [line] = lines;
    assert.ok(line);
    assert.equal(line.level, "error");
    assert.equal(line.msg, "bot check misconfigured");
    assert.ok("status" in line.obj && line.obj.status === 400);
  });

  it("lets the question through when Cloudflare is down, and warns", async () => {
    const answers: Answer[] = [
      "unreachable",
      // Past the time it has.
      "hang",
      "stall",
      // Stopped partway, where the status doesn't turn the request down.
      "cut-off",
      { status: 503, cutOff: true },
      { status: 500, text: "<html>Error</html>", type: "text/html" },
      { status: 429, text: "Too many requests", type: "text/plain" },
      { status: 200, body: turnedDown("internal-error") },
    ];
    for (const answer of answers) {
      const { verdict, lines } = await checkWith(answer);

      assert.equal(verdict, "passed");
      assert.deepEqual(
        lines.map(({ level, msg }) => ({ level, msg })),
        [{ level: "warn", msg: "bot check unavailable" }],
      );
      // Neither the secret nor the token goes into the log.
      const logged = JSON.stringify(lines);
      assert.ok(!logged.includes("turnstile-secret"));
      assert.ok(!logged.includes(TOKEN));
    }
  });
});
