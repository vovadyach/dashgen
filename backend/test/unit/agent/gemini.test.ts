import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Message } from "../../../src/agent/types.ts";
import {
  MODEL_CONTENT,
  QUESTION_MESSAGE,
  TOOLS,
} from "../../fixtures/gemini.ts";
import {
  type Answer,
  fakeGemini,
  failure,
  request,
} from "../../helpers/gemini.ts";

describe("createGeminiModel", () => {
  describe("requests", () => {
    it("sends the question with the design's settings: tool calls only, 512 tokens, minimal thinking", async () => {
      const { model, bodies } = fakeGemini();

      await model.next(request());

      const [body] = bodies;
      assert.ok(body);
      assert.deepEqual(body.contents, [
        { role: "user", parts: [{ text: QUESTION_MESSAGE.text }] },
      ]);
      assert.deepEqual(body.toolConfig, {
        functionCallingConfig: { mode: "ANY" },
      });
      assert.deepEqual(body.generationConfig, {
        maxOutputTokens: 512,
        thinkingConfig: { thinkingLevel: "MINIMAL" },
      });
      assert.match(JSON.stringify(body.systemInstruction), /You are DashGen\./);
    });

    it("declares each tool with its description, and its arguments as plain JSON Schema", async () => {
      const { model, bodies } = fakeGemini();

      await model.next(request());

      const declarations = (
        bodies[0]?.tools as {
          functionDeclarations: Record<string, unknown>[];
        }[]
      )[0]?.functionDeclarations;
      assert.ok(declarations);
      assert.deepEqual(
        declarations.map((d) => d.name),
        TOOLS.map((t) => t.name),
      );
      // A tool without arguments leaves them out, as Gemini asks.
      assert.equal(declarations[0]?.parametersJsonSchema, undefined);
      const query = declarations[1]?.parametersJsonSchema as Record<
        string,
        unknown
      >;
      assert.equal(query.$schema, undefined);
      assert.equal(query.additionalProperties, false);
      assert.deepEqual(query.required, ["service", "metric"]);
    });

    it("sends the model's reply back as it came, signature included, and each tool's output or error", async () => {
      // Two calls in one reply, one of them with Gemini's own call ID.
      const content = {
        role: "model",
        parts: [
          {
            functionCall: { name: "list_services", args: {} },
            thoughtSignature: "signature-1",
          },
          {
            functionCall: {
              id: "c2",
              name: "query_metrics",
              args: { service: "billing", metric: "errors" },
            },
          },
        ],
      };
      const { model, bodies } = fakeGemini({
        status: 200,
        body: { candidates: [{ content, finishReason: "STOP" }] },
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

      const contents = bodies[1]?.contents as unknown[];
      assert.deepEqual(contents[1], content);
      assert.deepEqual(contents[2], {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "list_services",
              response: { output: { services: ["checkout-api"] } },
            },
          },
          {
            functionResponse: {
              id: "c2",
              name: "query_metrics",
              response: { error: 'Unknown service "billing".' },
            },
          },
        ],
      });
    });

    it("refuses a conversation Gemini would refuse, before sending it", async () => {
      const { model, bodies } = fakeGemini();
      const reply = await model.next(request());
      const [call] = reply.calls;
      assert.ok(call);
      const output = { call, result: {} };
      const broken: [string, Message[], RegExp][] = [
        [
          "no question first",
          [
            { role: "model", reply },
            { role: "tools", outputs: [output] },
          ],
          /starts with the question/,
        ],
        [
          "a reply without its outputs",
          [QUESTION_MESSAGE, { role: "model", reply }],
          /needs one output, in the same order/,
        ],
        [
          "an output too many",
          [
            QUESTION_MESSAGE,
            { role: "model", reply },
            { role: "tools", outputs: [output, output] },
          ],
          /needs one output, in the same order/,
        ],
        [
          "an output for another call",
          [
            QUESTION_MESSAGE,
            { role: "model", reply },
            {
              role: "tools",
              outputs: [{ call: { name: "decline", args: {} }, result: {} }],
            },
          ],
          /needs one output, in the same order/,
        ],
        [
          "outputs without the reply that asked for them",
          [QUESTION_MESSAGE, { role: "tools", outputs: [output] }],
          /right after the reply that asked for them/,
        ],
        [
          "a reply without its raw",
          [
            QUESTION_MESSAGE,
            { role: "model", reply: { ...reply, raw: undefined } },
            { role: "tools", outputs: [output] },
          ],
          /with its raw/,
        ],
      ];

      for (const [what, messages, message] of broken) {
        await assert.rejects(model.next(request(messages)), { message }, what);
      }
      // Refused before sending anything.
      assert.equal(bodies.length, 1);
    });

    it("makes one request per next(): the SDK never continues an answer by itself", async () => {
      const unfinished = {
        candidates: [
          {
            content: MODEL_CONTENT,
            finishReason: "CONTINUATION",
            continuationToken: "more-1",
          },
        ],
      };
      const { model, bodies } = fakeGemini({ status: 200, body: unfinished });

      const reply = await model.next(request());

      assert.equal(reply.finishReason, "CONTINUATION");
      assert.equal(bodies.length, 1);
    });

    it("sends requests to the Gemini API, whatever GOOGLE_* variables say", async (t) => {
      const variables = {
        GOOGLE_GENAI_USE_VERTEXAI: "true",
        GOOGLE_GENAI_USE_ENTERPRISE: "true",
        GOOGLE_GEMINI_BASE_URL: "https://elsewhere.example/",
        GOOGLE_VERTEX_BASE_URL: "https://elsewhere.example/",
      };
      for (const [name, value] of Object.entries(variables)) {
        const before = process.env[name];
        process.env[name] = value;
        t.after(() => {
          if (before === undefined) Reflect.deleteProperty(process.env, name);
          else process.env[name] = before;
        });
      }
      const { model, urls } = fakeGemini();

      await model.next(request());

      assert.deepEqual(urls, [
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
      ]);
    });
  });

  describe("replies", () => {
    it("reads the calls, the text and the tokens, with thinking counted as output", async () => {
      const { model } = fakeGemini();

      const reply = await model.next(request());

      assert.deepEqual(reply, {
        calls: [{ name: "list_services", args: {} }],
        blocked: false,
        // The thought isn't part of the answer.
        text: "",
        finishReason: "STOP",
        usage: { inputTokens: 812, outputTokens: 65 },
        raw: MODEL_CONTENT,
      });
    });

    it("says if a safety filter blocked a reply without tool calls, keeps no raw, and won't send it back", async () => {
      const empties: [unknown, string, boolean][] = [
        [
          { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] },
          "MALFORMED_FUNCTION_CALL",
          false,
        ],
        [
          {
            candidates: [
              { content: { role: "model" }, finishReason: "MAX_TOKENS" },
            ],
          },
          "MAX_TOKENS",
          false,
        ],
        // A filter on the question, before any answer, and one on the answer.
        [
          { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } },
          "PROHIBITED_CONTENT",
          true,
        ],
        [{ candidates: [{ finishReason: "SAFETY" }] }, "SAFETY", true],
      ];
      for (const [body, finishReason, blocked] of empties) {
        const { model, bodies } = fakeGemini({ status: 200, body });

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
    it("marks a rate limit or an outage as worth one more try, but not a bad request", async () => {
      for (const [status, retryable] of [
        [429, true],
        [503, true],
        [400, false],
        [403, false],
      ] as const) {
        const { model } = fakeGemini(failure(status));

        await assert.rejects(model.next(request()), {
          name: "ModelError",
          // Gemini's own reason, not the JSON around it.
          message: `Gemini answered ${String(status)}: something failed`,
          status,
          retryable,
        });
      }
    });

    it("marks a request past its own timeout, or a network failure, as worth one more try", async () => {
      for (const answer of ["hang", "unreachable"] as const) {
        const { model } = fakeGemini(answer);

        await assert.rejects(model.next(request()), {
          name: "ModelError",
          retryable: true,
        });
      }
    });

    it("marks a connection cut partway through the answer, or an answer that isn't JSON, as worth one more try", async () => {
      const answers: Answer[] = [
        "cut-off",
        { status: 200, text: "<html>Bad gateway</html>" },
        { status: 503, text: "" },
      ];
      for (const answer of answers) {
        const { model } = fakeGemini(answer);

        await assert.rejects(model.next(request()), {
          name: "ModelError",
          retryable: true,
        });
      }
    });

    it("lets the run's own deadline through as an AbortError, since it isn't Gemini's failure", async () => {
      const { model } = fakeGemini("hang");
      const deadline = new AbortController();
      setTimeout(() => {
        deadline.abort();
      }, 10);

      await assert.rejects(
        model.next({ ...request(), signal: deadline.signal }),
        {
          name: "AbortError",
        },
      );
    });
  });
});
