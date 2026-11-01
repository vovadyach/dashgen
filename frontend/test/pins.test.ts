import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPins, PINS_KEY } from "../src/pins.ts";
import { CHART } from "./fixtures/run.ts";

const PIN = { chart: CHART, pinnedAt: "2026-10-31T10:00:00.000Z" };

const save = (value: unknown) => {
  localStorage.setItem(PINS_KEY, JSON.stringify(value));
};

describe("loadPins", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("reads the pins back in the order they were saved", () => {
    const older = { ...PIN, pinnedAt: "2026-10-30T10:00:00.000Z" };
    save([PIN, older]);
    expect(loadPins()).toEqual([PIN, older]);
  });

  it("leaves out an entry it can't read, and keeps the rest", () => {
    save([
      { chart: { ...CHART, type: "radar" }, pinnedAt: PIN.pinnedAt },
      { chart: CHART, pinnedAt: "yesterday" },
      { chart: CHART },
      "a chart",
      null,
      PIN,
    ]);
    expect(loadPins()).toEqual([PIN]);
  });

  it("reads no pins from nothing, from what isn't a list, or from what isn't JSON", () => {
    expect(loadPins()).toEqual([]);
    save({ pins: [PIN] });
    expect(loadPins()).toEqual([]);
    localStorage.setItem(PINS_KEY, "[{");
    expect(loadPins()).toEqual([]);
  });

  it("reads no pins when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(loadPins()).toEqual([]);
  });
});
