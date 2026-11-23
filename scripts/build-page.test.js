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

  it("builds with any site key Cloudflare can give: up to 32 characters, with no set prefix", () => {
    const keys = [
      // Cloudflare's own example, in its API reference.
      "0x4AAF00AAAABn0R22HWm-YUc",
      `0x4${"A".repeat(29)}`,
      "AAAAexampleSiteKey",
    ];
    for (const key of keys) {
      const { status, stdout } = build(key);

      assert.equal(status, 0);
      assert.equal(stdout, `npm run build --workspace frontend with ${key}\n`);
    }
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

  it("stops before building on a key longer than a site key's 32 characters, like the widget's secret key, and never prints it", () => {
    // One over the limit, and the length of DashGen's secret key.
    for (const length of [33, 35]) {
      const key = `0x4${"s".repeat(length - 3)}`;
      const { status, stdout } = build(key);

      assert.equal(status, 1);
      assert.match(
        stdout,
        new RegExp(`has ${length} characters, so it isn't a site key`),
      );
      assert.doesNotMatch(stdout, /npm run/);
      assert.ok(!stdout.includes(key));
    }
  });

  it("stops before building on a key with a space or line break pasted in", () => {
    for (const key of [
      " 0x4AAAAAAAexampleSiteKey",
      "0x4AAAAAAAexampleSiteKey\n",
    ]) {
      const { status, stdout } = build(key);

      assert.equal(status, 1);
      assert.match(stdout, /a space or a line break/);
      assert.doesNotMatch(stdout, /npm run/);
    }
  });
});
