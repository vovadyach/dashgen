import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import {
  loadConfig,
  loadDynamoTarget,
  loadModelSettings,
  MODELS,
} from "../../src/config.ts";
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
    assert.equal(config.model.apiKey.reveal(), "test-key");
  });

  it("counts an empty value as missing", () => {
    assert.throws(
      () => loadConfig({ ...VALID_ENV, GEMINI_API_KEY: "" }),
      /gemini-3\.1-flash-lite needs GEMINI_API_KEY/,
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

  it("defaults the model to the one the cost estimates use", () => {
    const { model } = loadConfig(VALID_ENV);
    assert.deepEqual(
      [model.name, model.provider],
      ["gemini-3.1-flash-lite", "gemini"],
    );
    assert.equal(
      loadConfig({ ...VALID_ENV, AI_MODEL: "gemini-3.5-flash-lite" }).model
        .name,
      "gemini-3.5-flash-lite",
    );
  });

  it("gives each model's provider and prices, for its adapter and each run's cost", () => {
    const env = { ...VALID_ENV, ANTHROPIC_API_KEY: "claude-key" };
    const models = [
      ["gemini-3.1-flash-lite", "gemini", { input: 0.25, output: 1.5 }],
      ["gemini-3.5-flash-lite", "gemini", { input: 0.3, output: 2.5 }],
      ["claude-haiku-5-5", "claude", { input: 0.1, output: 0.5 }],
    ] as const;
    for (const [name, provider, price] of models) {
      const { model } = loadConfig({ ...env, AI_MODEL: name });
      assert.equal(model.provider, provider, name);
      assert.deepEqual(model.price, price, name);
    }
  });

  it("accepts only the models it has an adapter and prices for", () => {
    // Gemini 2 lacks the thinking level and signatures DashGen uses, Claude
    // Sonnet 5.5 can't be forced to call a tool, and a model with no price
    // here would leave runs without a cost.
    for (const model of [
      "gemini-2.5-flash-lite",
      "gemini-3-pro",
      "claude-sonnet-5-5",
      "claude-haiku-4-5",
    ]) {
      assert.throws(
        () => loadConfig({ ...VALID_ENV, AI_MODEL: model }),
        /Use gemini-3\.1-flash-lite, gemini-3\.5-flash-lite, claude-haiku-5-5[\s\S]*at AI_MODEL/,
        model,
      );
    }
  });

  it("needs only the chosen model's key", () => {
    const claude = { ALLOWED_ORIGINS: VALID_ENV.ALLOWED_ORIGINS };
    assert.throws(
      () => loadConfig({ ...claude, AI_MODEL: "claude-haiku-5-5" }),
      /claude-haiku-5-5 needs ANTHROPIC_API_KEY[\s\S]*at ANTHROPIC_API_KEY/,
    );
    const { model } = loadConfig({
      ...claude,
      AI_MODEL: "claude-haiku-5-5",
      ANTHROPIC_API_KEY: "claude-key",
    });
    assert.equal(model.apiKey.reveal(), "claude-key");
    // An empty key for the other provider is no matter.
    assert.equal(
      loadConfig({ ...VALID_ENV, ANTHROPIC_API_KEY: "" }).model.provider,
      "gemini",
    );
  });

  it("stops at the old GEMINI_MODEL, so a leftover setting isn't ignored without a word", () => {
    assert.throws(
      () => loadConfig({ ...VALID_ENV, GEMINI_MODEL: "gemini-3.5-flash-lite" }),
      /GEMINI_MODEL is now AI_MODEL/,
    );
  });
});

describe("MODELS", () => {
  it("names the same models and providers as the session stack, which checks TF_VAR_ai_model before AWS makes anything", () => {
    const stack = readFileSync(
      new URL("../../../infra/aws/session/secrets.tf", import.meta.url),
      "utf8",
    );
    const block = /model_providers = \{([^}]*)\}/.exec(stack)?.[1];
    assert.ok(block, "infra/aws/session/secrets.tf has no model_providers");
    const listed = Object.fromEntries(
      [...block.matchAll(/"([^"]+)"\s*=\s*"([^"]+)"/g)].map((match) => [
        String(match[1]),
        String(match[2]),
      ]),
    );

    assert.deepEqual(
      listed,
      Object.fromEntries(
        Object.entries(MODELS).map(([name, { provider }]) => [name, provider]),
      ),
    );
  });
});

describe("loadConfig's daily cap", () => {
  it("defaults to 150 questions a day, and takes only a whole number above 0", () => {
    assert.equal(loadConfig(VALID_ENV).dailyCap, 150);
    assert.equal(loadConfig({ ...VALID_ENV, DAILY_CAP: "300" }).dailyCap, 300);
    for (const typo of ["0", "-5", "1.5", "lots", ""]) {
      assert.throws(
        () => loadConfig({ ...VALID_ENV, DAILY_CAP: typo }),
        /DAILY_CAP/,
        typo,
      );
    }
  });
});

describe("loadConfig's address", () => {
  it("listens on localhost:3000 by default, and takes a port only from 1 to 65535", () => {
    const { host, port } = loadConfig(VALID_ENV);
    assert.deepEqual([host, port], ["localhost", 3000]);
    const container = loadConfig({
      ...VALID_ENV,
      HOST: "0.0.0.0",
      PORT: "8080",
    });
    assert.deepEqual([container.host, container.port], ["0.0.0.0", 8080]);
    for (const typo of ["0", "70000", "http", ""]) {
      assert.throws(
        () => loadConfig({ ...VALID_ENV, PORT: typo }),
        /PORT/,
        typo,
      );
    }
  });
});

describe("loadDynamoTarget", () => {
  it("defaults to DynamoDB Local on this machine, and rejects what isn't an HTTP address", () => {
    assert.deepEqual(loadDynamoTarget({}), {
      endpoint: "http://localhost:8000",
    });
    assert.deepEqual(
      loadDynamoTarget({ DYNAMODB_ENDPOINT: "http://dynamodb:8000" }),
      { endpoint: "http://dynamodb:8000" },
    );
    assert.throws(
      () => loadDynamoTarget({ DYNAMODB_ENDPOINT: "localhost:8000" }),
      /DYNAMODB_ENDPOINT/,
    );
  });

  it("reaches AWS only with DYNAMODB_REGION, never from the AWS settings a developer's shell may have", () => {
    assert.deepEqual(loadDynamoTarget({ DYNAMODB_REGION: "us-east-1" }), {
      region: "us-east-1",
    });
    assert.deepEqual(
      loadDynamoTarget({ AWS_REGION: "us-east-1", AWS_PROFILE: "default" }),
      { endpoint: "http://localhost:8000" },
    );
    assert.throws(
      () =>
        loadDynamoTarget({
          DYNAMODB_REGION: "us-east-1",
          DYNAMODB_ENDPOINT: "http://localhost:8000",
        }),
      /not both/,
    );
    assert.throws(
      () => loadDynamoTarget({ DYNAMODB_REGION: "local" }),
      /DYNAMODB_REGION/,
    );
  });
});

describe("loadModelSettings", () => {
  it("loads without the other settings, for scripts, with the key hidden", () => {
    const settings = loadModelSettings({ GEMINI_API_KEY: "test-key" });

    assert.equal(settings.name, "gemini-3.1-flash-lite");
    assert.ok(!inspect(settings).includes("test-key"));
    assert.equal(
      loadModelSettings({
        AI_MODEL: "claude-haiku-5-5",
        ANTHROPIC_API_KEY: "claude-key",
      }).provider,
      "claude",
    );
    assert.throws(() => loadModelSettings({}), /GEMINI_API_KEY/);
  });
});
