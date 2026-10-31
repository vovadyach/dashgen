import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import { loadConfig, loadGeminiSettings } from "../../src/config.ts";
import { VALID_ENV } from "../fixtures/config.ts";

describe("loadConfig", () => {
  it("reads comma-separated origins", () => {
    const config = loadConfig({
      ...VALID_ENV,
      ALLOWED_ORIGINS: "http://localhost:5173, https://a.example",
    });

    assert.deepEqual(config.allowedOrigins, [
      "http://localhost:5173",
      "https://a.example",
    ]);
  });

  it("hides the API key when printed", () => {
    const config = loadConfig(VALID_ENV);

    assert.ok(!inspect(config).includes("test-key"));
    assert.ok(!JSON.stringify(config).includes("test-key"));
    assert.equal(config.geminiApiKey.reveal(), "test-key");
  });

  it("counts an empty value as missing", () => {
    assert.throws(
      () => loadConfig({ ...VALID_ENV, GEMINI_API_KEY: "" }),
      /GEMINI_API_KEY/,
    );
  });

  it("needs at least one origin", () => {
    assert.throws(
      () => loadConfig({ ...VALID_ENV, ALLOWED_ORIGINS: " , " }),
      /ALLOWED_ORIGINS/,
    );
  });

  it("defaults the log level to info, and rejects a typo", () => {
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

  it("defaults the Gemini model to the one the cost estimates use", () => {
    assert.equal(loadConfig(VALID_ENV).geminiModel, "gemini-3.1-flash-lite");
    assert.equal(
      loadConfig({ ...VALID_ENV, GEMINI_MODEL: "gemini-3.5-flash-lite" })
        .geminiModel,
      "gemini-3.5-flash-lite",
    );
  });

  it("gives the model's prices, for each run's cost", () => {
    assert.deepEqual(loadConfig(VALID_ENV).geminiPrice, {
      input: 0.25,
      output: 1.5,
    });
    assert.deepEqual(
      loadConfig({ ...VALID_ENV, GEMINI_MODEL: "gemini-3.5-flash-lite" })
        .geminiPrice,
      { input: 0.3, output: 2.5 },
    );
  });

  it("accepts only the Gemini 3 models it has prices for", () => {
    // Gemini 2 lacks the thinking level and signatures DashGen uses, and a
    // Gemini 3 model with no price here would leave runs without a cost.
    for (const model of ["gemini-2.5-flash-lite", "gemini-3-pro"]) {
      assert.throws(
        () => loadConfig({ ...VALID_ENV, GEMINI_MODEL: model }),
        /Use gemini-3\.1-flash-lite or gemini-3\.5-flash-lite[\s\S]*at GEMINI_MODEL/,
      );
    }
  });
});

describe("loadGeminiSettings", () => {
  it("loads without the other settings, for scripts, with the key hidden", () => {
    const settings = loadGeminiSettings({ GEMINI_API_KEY: "test-key" });

    assert.equal(settings.model, "gemini-3.1-flash-lite");
    assert.ok(!inspect(settings).includes("test-key"));
    assert.throws(() => loadGeminiSettings({}), /GEMINI_API_KEY/);
  });
});
