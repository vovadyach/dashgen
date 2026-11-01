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
      {
        chart: {
          ...CHART,
          series: [
            { name: "payments-service", points: [{ x: "not a date", y: 1 }] },
          ],
        },
        pinnedAt: PIN.pinnedAt,
      },
      { chart: CHART },
      "a chart",
      null,
      PIN,
    ]);
    expect(loadPins()).toEqual([PIN]);
  });

  it("leaves out a pin with more points than any chart DashGen makes", () => {
    const crowded = {
      ...PIN,
      chart: {
        ...CHART,
        series: [
          {
            name: "payments-service",
            points: Array.from({ length: 721 }, () => ({
              x: "2026-10-25T00:00:00.000Z",
              y: 0,
            })),
          },
        ],
      },
    };
    save([crowded, PIN]);
    expect(loadPins()).toEqual([PIN]);
  });

  it("keeps saying a pin's chart came from a link", () => {
    const fromLink = { ...PIN, fromLink: true };
    const older = { ...PIN, pinnedAt: "2026-10-30T10:00:00.000Z" };
    save([fromLink, { ...older, fromLink: "yes" }]);
    expect(loadPins()).toEqual([fromLink, older]);
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
