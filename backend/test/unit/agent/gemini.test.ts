import assert from "node:assert/strict";
import { test } from "node:test";

import { createGeminiModel } from "../../../src/agent/gemini.ts";
import { createTools } from "../../../src/agent/tools.ts";
import type { Message } from "../../../src/agent/types.ts";

// Only the tools' names, descriptions and schemas matter here.
const unused = () => Promise.reject(new Error("not called in these tests"));
const TOOLS = createTools({ listServices: unused, query: unused });

const QUESTION: Message = {
  role: "user",
  text: "Show errors for payments-service this week",
};

// What Gemini answers: a tool call, with the signature Gemini 3 wants back.
const MODEL_CONTENT = {
  role: "model",
  parts: [
    { text: "Checking the names first.", thought: true },
    {
      functionCall: { name: "list_services", args: {} },
      thoughtSignature: "signature-1",
    },
  ],
};
const ANSWER = {
  candidates: [{ content: MODEL_CONTENT, finishReason: "STOP" }],
  usageMetadata: {
    promptTokenCount: 812,
    candidatesTokenCount: 40,
    thoughtsTokenCount: 25,
  },
};

type Answer =
  | { status: number; body: unknown }
  // A body that isn't JSON, like a proxy's error page.
  | { status: number; text: string }
  // Headers arrive, then the connection drops partway through the body.
  | "cut-off"
  // Never answers; only an abort, from the timeout or the run, ends it.
  | "hang"
  | "unreachable";

const JSON_TYPE = { "content-type": "application/json" };

/** Stands in for Google: records each request's URL and body, and gives the next answer. */
function fakeGemini(...answers: Answer[]) {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetch = (url: unknown, init?: RequestInit) => {
    urls.push(
      url instanceof URL ? url.href : typeof url === "string" ? url : "",
    );
    // The SDK always sends its body as a JSON string.
    const body = typeof init?.body === "string" ? init.body : "{}";
    bodies.push(JSON.parse(body) as Record<string, unknown>);
    const answer = answers.shift() ?? { status: 200, body: ANSWER };
    if (answer === "unreachable") {
      return Promise.reject(new TypeError("fetch failed"));
    }
    if (answer === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        };
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort);
      });
    }
    if (answer === "cut-off") {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: JSON_TYPE }),
      );
    }
    return Promise.resolve(
      new Response(
        "text" in answer ? answer.text : JSON.stringify(answer.body),
        {
          status: answer.status,
          headers: JSON_TYPE,
        },
      ),
    );
  };
  const model = createGeminiModel({
    apiKey: "test-key",
    model: "gemini-3.1-flash-lite",
    timeoutMs: 50,
    fetch,
  });
  return { model, urls, bodies };
}

const request = (messages: Message[] = [QUESTION]) => ({
  system: "You are DashGen.",
  messages,
  tools: TOOLS,
});

const failure = (status: number) => ({
  status,
  body: { error: { code: status, message: "something failed" } },
});

test("sends the question with the design's settings: tool calls only, 512 tokens, minimal thinking", async () => {
  const { model, bodies } = fakeGemini();

  await model.next(request());

  const [body] = bodies;
  assert.ok(body);
  assert.deepEqual(body.contents, [
    { role: "user", parts: [{ text: QUESTION.text }] },
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

test("declares each tool with its description, and its arguments as plain JSON Schema", async () => {
  const { model, bodies } = fakeGemini();

  await model.next(request());

  const declarations = (
    bodies[0]?.tools as { functionDeclarations: Record<string, unknown>[] }[]
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

test("reads the calls, the text and the tokens, with thinking counted as output", async () => {
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

test("sends the model's reply back as it came, signature included, and each tool's output or error", async () => {
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
      QUESTION,
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

test("a conversation Gemini would refuse is refused before it's sent", async () => {
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
      [QUESTION, { role: "model", reply }],
      /needs one output, in the same order/,
    ],
    [
      "an output too many",
      [
        QUESTION,
        { role: "model", reply },
        { role: "tools", outputs: [output, output] },
      ],
      /needs one output, in the same order/,
    ],
    [
      "an output for another call",
      [
        QUESTION,
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
      [QUESTION, { role: "tools", outputs: [output] }],
      /right after the reply that asked for them/,
    ],
    [
      "a reply without its raw",
      [
        QUESTION,
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

test("a rate limit or an outage is worth one more try; a bad request isn't", async () => {
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

test("a request past its own timeout, or a network failure, is worth one more try", async () => {
  for (const answer of ["hang", "unreachable"] as const) {
    const { model } = fakeGemini(answer);

    await assert.rejects(model.next(request()), {
      name: "ModelError",
      retryable: true,
    });
  }
});

test("the run's own deadline isn't Gemini's failure, so it isn't retried", async () => {
  const { model } = fakeGemini("hang");
  const deadline = new AbortController();
  setTimeout(() => {
    deadline.abort();
  }, 10);

  await assert.rejects(model.next({ ...request(), signal: deadline.signal }), {
    name: "AbortError",
  });
});

test("a connection cut partway through the answer, or an answer that isn't JSON, is worth one more try", async () => {
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

test("one next() is one request: the SDK never continues an answer by itself", async () => {
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

test("requests go to the Gemini API, whatever GOOGLE_* variables say", async (t) => {
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

test("a reply without tool calls says if a safety filter blocked it, keeps no raw, and can't go back in the conversation", async () => {
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
      model.next(request([QUESTION, { role: "model", reply }])),
      { message: /can't go back in the conversation/ },
    );
    // Refused before sending anything.
    assert.equal(bodies.length, 1);
  }
});
