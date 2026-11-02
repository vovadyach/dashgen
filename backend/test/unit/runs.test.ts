import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCosts } from "../../src/runs/cost.ts";
import { createRunStore } from "../../src/runs/live.ts";
import { recordingLogger } from "../helpers/logger.ts";

describe("createRunStore", () => {
  it("numbers a run's events from 1, and tells its listeners each new one, then the end", () => {
    const store = createRunStore<string>({ log: recordingLogger().log });
    const heard: string[] = [];
    store.start("r1");
    store.add("r1", "first");

    store.listen("r1", {
      event: (id, event) => heard.push(`${String(id)} ${event}`),
      end: () => heard.push("end"),
    });
    store.add("r1", "second");
    store.end("r1");
    store.add("r1", "too late");

    assert.deepEqual(heard, ["2 second", "end"]);
    assert.deepEqual(store.get("r1")?.events, ["first", "second"]);
    assert.equal(store.get("r1")?.ended, true);
  });

  it("stops telling a listener once it stops listening", () => {
    const store = createRunStore<string>({ log: recordingLogger().log });
    const heard: string[] = [];
    store.start("r1");

    const stop = store.listen("r1", {
      event: (_id, event) => heard.push(event),
      end: () => heard.push("end"),
    });
    stop();
    store.add("r1", "first");
    store.end("r1");

    assert.deepEqual(heard, []);
  });

  it("keeps going when a listener throws, and logs it", () => {
    const { log, lines } = recordingLogger();
    const store = createRunStore<string>({ log });
    const heard: string[] = [];
    store.start("r1");

    store.listen("r1", {
      event: () => {
        throw new Error("the stream is closed");
      },
      end: () => undefined,
    });
    store.listen("r1", {
      event: (_id, event) => heard.push(event),
      end: () => undefined,
    });
    store.add("r1", "first");

    assert.deepEqual(heard, ["first"]);
    assert.deepEqual(
      lines.map((l) => l.msg),
      ["a run's listener failed"],
    );
  });

  it("keeps a run 5 minutes after it ends, then forgets it", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const store = createRunStore<string>({ log: recordingLogger().log });
    store.start("r1");
    store.end("r1");

    t.mock.timers.tick(5 * 60_000 - 1);
    assert.ok(store.get("r1"));
    t.mock.timers.tick(1);
    assert.equal(store.get("r1"), undefined);
  });

  it("knows no run it didn't start", () => {
    const store = createRunStore<string>({ log: recordingLogger().log });

    assert.equal(store.get("r9"), undefined);
  });
});

describe("formatCosts", () => {
  it("lists each day as it comes, with its cost per question, and a total under them", () => {
    assert.equal(
      formatCosts([
        { day: "2026-11-02", questions: 42, costUsd: 0.4637 },
        { day: "2026-11-01", questions: 3, costUsd: 0.0129 },
      ]),
      [
        "Day (UTC)    Questions      Cost   Per question",
        "2026-11-02          42   $0.4637        $0.0110",
        "2026-11-01           3   $0.0129        $0.0043",
        "Total               45   $0.4766        $0.0106",
      ].join("\n"),
    );
  });

  it("says so when there are no runs yet", () => {
    assert.equal(formatCosts([]), "No runs yet.");
  });
});
