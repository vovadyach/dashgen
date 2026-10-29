import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";

import { loadConfig, loadGeminiSettings } from "../../src/config.ts";
import { VALID_ENV } from "../helpers/app.ts";

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

test("the log level defaults to info, and rejects a typo", () => {
  assert.equal(loadConfig(VALID_ENV).logLevel, "info");
  assert.equal(
    loadConfig({ ...VALID_ENV, LOG_LEVEL: "debug" }).logLevel,
    "debug",
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, LOG_LEVEL: "verbose" }),
    /LOG_LEVEL/,
  );
});

test("the Gemini model defaults to the one the cost estimates use", () => {
  assert.equal(loadConfig(VALID_ENV).geminiModel, "gemini-3.1-flash-lite");
  assert.equal(
    loadConfig({ ...VALID_ENV, GEMINI_MODEL: "gemini-3.5-flash-lite" })
      .geminiModel,
    "gemini-3.5-flash-lite",
  );
});

test("the Gemini settings load alone, for scripts, with the key hidden", () => {
  const settings = loadGeminiSettings({ GEMINI_API_KEY: "test-key" });

  assert.equal(settings.model, "gemini-3.1-flash-lite");
  assert.ok(!inspect(settings).includes("test-key"));
  assert.throws(() => loadGeminiSettings({}), /GEMINI_API_KEY/);
});

test("only Gemini 3 models, whose thinking level and signatures DashGen uses", () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, GEMINI_MODEL: "gemini-2.5-flash-lite" }),
    /Use a Gemini 3 model[\s\S]*at GEMINI_MODEL/,
  );
});
