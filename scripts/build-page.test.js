import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, describe, it } from "node:test";
import { fileURLToPath, URL } from "node:url";

const script = fileURLToPath(new URL("build-page.sh", import.meta.url));

// A stand-in for npm, first on the PATH, which says how it was called.
const bin = mkdtempSync(join(tmpdir(), "build-page-"));
writeFileSync(
  join(bin, "npm"),
  '#!/bin/sh\necho "npm $* with $VITE_TURNSTILE_SITE_KEY"\n',
  { mode: 0o755 },
);
after(() => {
  rmSync(bin, { recursive: true, force: true });
});

/** Runs the script, as from a terminal, with `key` as the site key. */
function build(key) {
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  delete env.GITHUB_ACTIONS;
  delete env.VITE_TURNSTILE_SITE_KEY;
  if (key !== undefined) env.VITE_TURNSTILE_SITE_KEY = key;
  return spawnSync(script, { env, encoding: "utf8" });
}

describe("build-page.sh", () => {
  it("builds the page with the site key of DashGen's own widget", () => {
    const { status, stdout } = build("0x4AAAAAAAexampleSiteKey");

    assert.equal(status, 0);
    assert.equal(
      stdout,
      "npm run build --workspace frontend with 0x4AAAAAAAexampleSiteKey\n",
    );
  });

  it("stops before building without a site key, as when gh variable get fails", () => {
    for (const key of [undefined, ""]) {
      const { status, stdout } = build(key);

      assert.equal(status, 1);
      assert.match(stdout, /^Set VITE_TURNSTILE_SITE_KEY/);
      assert.doesNotMatch(stdout, /npm run/);
    }
  });

  it("stops before building on Cloudflare's test site keys, whose tokens the real secret turns down", () => {
    const testKeys = [
      "1x00000000000000000000AA",
      "2x00000000000000000000AB",
      "1x00000000000000000000BB",
      "2x00000000000000000000BB",
      "3x00000000000000000000FF",
    ];
    for (const key of testKeys) {
      const { status, stdout } = build(key);

      assert.equal(status, 1);
      assert.match(stdout, /one of Cloudflare's test keys/);
      assert.doesNotMatch(stdout, /npm run/);
    }
  });

  it("stops before building on the widget's secret key, which would be public in the page, and never prints it", () => {
    // Shaped like a secret key: 0x4 and 32 more, 35 in all.
    const secret = `0x4AAAAAAAexampleSiteKey${"s".repeat(11)}`;
    const { status, stdout } = build(secret);

    assert.equal(status, 1);
    assert.match(stdout, /isn't a site key.*it has 35/);
    assert.doesNotMatch(stdout, /npm run/);
    assert.ok(!stdout.includes(secret));
  });

  it("stops before building on anything else not shaped like a site key, like a placeholder", () => {
    const keys = [
      "paste-the-site-key",
      // One short, and one with a space pasted in front.
      "0x4AAAAAAAexampleSiteKe",
      " 0x4AAAAAAAexampleSiteKey",
    ];
    for (const key of keys) {
      const { status, stdout } = build(key);

      assert.equal(status, 1);
      assert.match(stdout, /isn't a site key/);
      assert.doesNotMatch(stdout, /npm run/);
    }
  });
});
