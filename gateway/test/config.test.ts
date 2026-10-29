import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";

import { loadConfig } from "../src/config.ts";
import { VALID_ENV } from "./helpers.ts";

test("reads comma-separated origins", () => {
  const config = loadConfig({
    ...VALID_ENV,
    ALLOWED_ORIGINS: "http://localhost:5173, https://a.example",
  });

  assert.deepEqual(config.allowedOrigins, [
    "http://localhost:5173",
    "https://a.example",
  ]);
});

test("hides the API key when printed", () => {
  const config = loadConfig(VALID_ENV);

  assert.ok(!inspect(config).includes("test-key"));
  assert.ok(!JSON.stringify(config).includes("test-key"));
  assert.equal(config.geminiApiKey.reveal(), "test-key");
});

test("an empty value counts as missing", () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, GEMINI_API_KEY: "" }),
    /GEMINI_API_KEY/,
  );
});

test("needs at least one origin", () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, ALLOWED_ORIGINS: " , " }),
    /ALLOWED_ORIGINS/,
  );
});

test("needs a valid metrics URL", () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, METRICS_BASE_URL: "not a url" }),
    /METRICS_BASE_URL/,
  );
});
