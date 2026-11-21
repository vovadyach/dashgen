import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ModelError } from "../../../src/agent/errors.ts";
import type { ModelReply } from "../../../src/agent/types.ts";
import { QUESTION_MESSAGE, TOOLS } from "../../fixtures/agent.ts";
import {
  CLAUDE_ANSWER,
  CLAUDE_CONTENT,
  claudeAnswer,
} from "../../fixtures/claude.ts";
import { MODEL_CONTENT } from "../../fixtures/gemini.ts";
import { claudeFailure, fakeClaude } from "../../helpers/claude.ts";
import type { Answer } from "../../helpers/fetch.ts";
import { request } from "../../helpers/model.ts";

describe("createClaudeModel", () => {
  describe("requests", () => {
    it("sends the question with the design's settings: tool calls only, 1,024 tokens, low effort", async () => {
      const { model, bodies } = fakeClaude();

      await model.next(request());

      const [body] = bodies;
      assert.ok(body);
      assert.equal(body.model, "claude-haiku-5-5");
      assert.equal(body.system, "You are DashGen.");
      assert.deepEqual(body.messages, [
        { role: "user", content: QUESTION_MESSAGE.text },
      ]);
      assert.deepEqual(body.tool_choice, { type: "any" });
      assert.equal(body.max_tokens, 1_024);
      assert.deepEqual(body.output_config, { effort: "low" });
      // Claude Haiku 5.5 refuses sampling settings, and a forced call skips thinking.
      for (const unset of ["temperature", "top_p", "top_k", "thinking"]) {
        assert.equal(body[unset], undefined, unset);
      }
    });

    it("declares each tool with its description, and its arguments as plain JSON Schema", async () => {
      const { model, bodies } = fakeClaude();

      await model.next(request());

      const tools = bodies[0]?.tools as Record<string, unknown>[];
      assert.deepEqual(
        tools.map((t) => t.name),
        TOOLS.map((t) => t.name),
      );
      assert.deepEqual(
        tools.map((t) => t.description),
        TOOLS.map((t) => t.description),
      );
      // Not strict, which would refuse the arguments' limits.
      assert.ok(tools.every((t) => t.strict === undefined));
      // A tool without arguments still declares an object.
      assert.deepEqual(tools[0]?.input_schema, {
        type: "object",
        properties: {},
        additionalProperties: false,
      });
      const query = tools[1]?.input_schema as Record<string, unknown>;
      assert.equal(query.$schema, undefined);
      assert.equal(query.type, "object");
      assert.equal(query.additionalProperties, false);
      assert.deepEqual(query.required, ["service", "metric"]);
    });

    it("sends the model's reply back as it came, and every tool's output or error in one message", async () => {
      // Two calls in one reply, after a note.
      const content = [
        { type: "text", text: "Two calls.", citations: null },
        {
          type: "tool_use",
          id: "toolu_01",
          name: "list_services",
          input: {},
          caller: { type: "direct" },
        },
        {
          type: "tool_use",
          id: "toolu_02",
          name: "query_metrics",
          input: { service: "billing", metric: "errors" },
          caller: { type: "direct" },
        },
      ];
      const { model, bodies } = fakeClaude({
        status: 200,
        body: claudeAnswer(content, "tool_use"),
      });
      const reply = await model.next(request());
      const [list, query] = reply.calls;
      assert.ok(list && query);

      await model.next(
        request([
          QUESTION_MESSAGE,
          { role: "model", reply },
          {
            role: "tools",
            outputs: [
              { call: list, result: { services: ["checkout-api"] } },
              { call: query, error: 'Unknown service "billing".' },
            ],
          },
        ]),
      );

      const messages = bodies[1]?.messages as unknown[];
      assert.deepEqual(messages[1], { role: "assistant", content });
      assert.deepEqual(messages[2], {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_01",
            content: JSON.stringify({ services: ["checkout-api"] }),
          },
          {
            type: "tool_result",
            tool_use_id: "toolu_02",
            content: 'Unknown service "billing".',
            is_error: true,
          },
        ],
      });
    });

    it("refuses a reply from another model, or a call without its ID, before sending anything", async () => {
      const { model, bodies } = fakeClaude();
      const call = { name: "list_services", args: {} };
      const geminiReply: ModelReply = {
        calls: [call],
        blocked: false,
        text: "",
        finishReason: "STOP",
        usage: { inputTokens: 0, outputTokens: 0 },
        raw: MODEL_CONTENT,
      };
      const cases: [ModelReply, RegExp][] = [
        [geminiReply, /came from another model, so it can't go back to Claude/],
        [
          { ...geminiReply, raw: CLAUDE_CONTENT },
          /list_services call has no ID/,
        ],
      ];

      for (const [reply, message] of cases) {
        await assert.rejects(
          model.next(
            request([
              QUESTION_MESSAGE,
              { role: "model", reply },
              { role: "tools", outputs: [{ call, result: {} }] },
            ]),
          ),
          { message },
        );
      }
      assert.equal(bodies.length, 0);
    });

    it("makes one request per next(): the SDK never retries by itself", async () => {
      for (const status of [429, 529]) {
        const { model, bodies } = fakeClaude(claudeFailure(status));

        await assert.rejects(model.next(request()), { name: "ModelError" });

        assert.equal(bodies.length, 1, String(status));
      }
    });

    it("sends requests to the Claude API with its own key, whatever ANTHROPIC_* variables say", async (t) => {
      const variables = {
        ANTHROPIC_BASE_URL: "https://elsewhere.example/",
        ANTHROPIC_API_KEY: "another-key",
        ANTHROPIC_AUTH_TOKEN: "another-token",
        // The SDK adds these to every request, after its own key.
        ANTHROPIC_CUSTOM_HEADERS:
          "Authorization: Bearer another-token\nX-Api-Key: another-key",
      };
      for (const [name, value] of Object.entries(variables)) {
        const before = process.env[name];
        process.env[name] = value;
        t.after(() => {
          if (before === undefined) Reflect.deleteProperty(process.env, name);
          else process.env[name] = before;
        });
      }
      const { model, urls, headers } = fakeClaude();

      await model.next(request());

      assert.deepEqual(urls, ["https://api.anthropic.com/v1/messages"]);
      // The SDK sends a key as a bearer token, and only this one.
      const [sent] = headers;
      assert.ok(sent);
      assert.equal(sent.get("authorization"), "Bearer test-key");
      assert.equal(sent.get("x-api-key"), null);
    });
  });

  describe("replies", () => {
    it("reads the calls with their IDs, the text and the tokens", async () => {
      const { model } = fakeClaude();

      const reply = await model.next(request());

      assert.deepEqual(reply, {
        calls: [{ id: "toolu_01", name: "list_services", args: {} }],
        blocked: false,
        text: "Checking the names first.",
        finishReason: "tool_use",
        usage: { inputTokens: 812, outputTokens: 65 },
        raw: CLAUDE_CONTENT,
      });
    });

    it("counts cached tokens as input", async () => {
      const usage = {
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
      };
      const { model } = fakeClaude({
        status: 200,
        body: { ...CLAUDE_ANSWER, usage },
      });

      const reply = await model.next(request());

      assert.deepEqual(reply.usage, { inputTokens: 150, outputTokens: 10 });
    });

    it("says if a safety classifier declined, trusts no call cut off by the token limit, keeps no raw, and won't send it back", async () => {
      const cutOffCall = {
        type: "tool_use",
        id: "toolu_09",
        name: "create_chart",
        input: { type: "line" },
        caller: { type: "direct" },
      };
      const empties: [unknown, string, boolean][] = [
        [
          {
            ...claudeAnswer([], "refusal"),
            stop_details: { type: "refusal", category: "cyber" },
          },
          "refusal",
          true,
        ],
        [claudeAnswer([cutOffCall], "max_tokens"), "max_tokens", false],
        [
          claudeAnswer(
            [{ type: "text", text: "Here you go.", citations: null }],
            "end_turn",
          ),
          "end_turn",
          false,
        ],
      ];
      for (const [body, finishReason, blocked] of empties) {
        const { model, bodies } = fakeClaude({ status: 200, body });

        const reply = await model.next(request());

        assert.deepEqual(reply.calls, []);
        assert.equal(reply.finishReason, finishReason);
        assert.equal(reply.blocked, blocked);
        assert.equal(reply.raw, undefined);
        await assert.rejects(
          model.next(request([QUESTION_MESSAGE, { role: "model", reply }])),
          { message: /can't go back in the conversation/ },
        );
        // Refused before sending anything.
        assert.equal(bodies.length, 1);
      }
    });
  });

  describe("errors", () => {
    it("marks a rate limit, an outage or an overload as worth one more try, but not a bad request", async () => {
      for (const [status, retryable] of [
        [429, true],
        [503, true],
        [529, true],
        [400, false],
        [401, false],
        [403, false],
      ] as const) {
        const { model } = fakeClaude(claudeFailure(status));

        await assert.rejects(model.next(request()), {
          name: "ModelError",
          // Claude's own reason, not the JSON around it.
          message: `Claude answered ${String(status)}: something failed`,
          status,
          retryable,
        });
      }
    });

    it("marks a request past its own timeout, or a network failure, as worth one more try", async () => {
      for (const answer of ["hang", "unreachable"] as const) {
        const { model } = fakeClaude(answer);

        await assert.rejects(model.next(request()), {
          name: "ModelError",
          retryable: true,
        });
      }
    });

    it(
      "marks an answer whose body stalls past the request's own timeout as worth one more try",
      {
        timeout: 2_000,
      },
      async () => {
        const { model } = fakeClaude("stall");

        await assert.rejects(model.next(request()), {
          name: "ModelError",
          message: "Claude didn't answer in time.",
          retryable: true,
        });
      },
    );

    it("marks a connection cut partway through the answer, or an answer it can't read, as worth one more try", async () => {
      const answers: Answer[] = [
        "cut-off",
        { status: 200, text: "<html>Bad gateway</html>" },
        // The SDK hands these back as they are, as text, null or an object.
        { status: 200, text: "<html>Bad gateway</html>", type: "text/html" },
        "no-content",
        { status: 200, body: {} },
        // A call without its ID: its tool would run, then its result couldn't
        // go back to Claude.
        {
          status: 200,
          body: claudeAnswer(
            [{ type: "tool_use", name: "list_services", input: {} }],
            "tool_use",
          ),
        },
        // A token count that isn't a number, which would turn the sum into text.
        {
          status: 200,
          body: {
            ...CLAUDE_ANSWER,
            usage: { ...CLAUDE_ANSWER.usage, cache_read_input_tokens: "5" },
          },
        },
        { status: 503, text: "" },
      ];
      for (const answer of answers) {
        const { model } = fakeClaude(answer);

        await assert.rejects(
          model.next(request()),
          { name: "ModelError", retryable: true },
          JSON.stringify(answer),
        );
      }
    });

    it("lets the run's own deadline through as it is, since it isn't Claude's failure", async () => {
      const { model } = fakeClaude("hang");
      const deadline = new AbortController();
      setTimeout(() => {
        deadline.abort();
      }, 10);

      await assert.rejects(
        model.next({ ...request(), signal: deadline.signal }),
        (error) => !(error instanceof ModelError),
      );
      assert.ok(deadline.signal.aborted);
    });
  });
});
