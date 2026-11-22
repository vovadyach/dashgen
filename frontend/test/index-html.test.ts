import { readFileSync } from "node:fs";

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TIMEOUT_MS } from "../src/health.ts";

// From disk, by path, as the browser gets it. Through a function: Vite
// turns a plain new URL("…", import.meta.url) into an asset's URL.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url).pathname, "utf8");
const html = read("../index.html");
/** The script that runs while the page's code downloads. */
const loading =
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1] ?? "")
    .find((code) => code.includes("dashgenHealth")) ?? "";
const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";

/** index.html's body, and its script, run as the browser would, with `fetch` for the network. */
function load(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", fetch);
  document.body.innerHTML = body;
  // At the top level, as a script of the page.
  globalThis.eval(loading);
}

const never = () => new Promise<Response>(() => undefined);

describe("index.html, while the page's code downloads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete window.dashgenHealth;
    document.body.innerHTML = "";
  });

  it("asks whether DashGen is up, as the page would, and keeps the answer for it", async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({ status: "ok" })));
    load(fetch);
    expect(fetch).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ cache: "no-store" }),
    );
    const answer = { status: 200, body: { status: "ok" } };
    await expect(window.dashgenHealth?.check).resolves.toEqual(answer);
    expect(window.dashgenHealth?.answer).toEqual(answer);
  });

  it("gives the backend the page's 3 seconds to answer", async () => {
    vi.useFakeTimers();
    load(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(window.dashgenHealth?.answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    // No answer in time: offline.
    expect(window.dashgenHealth?.answer).toBeNull();
  });

  it("says DashGen couldn't load when the page's script fails, while the loader is there", () => {
    load(never);
    expect(screen.getByRole("status").textContent).toBe("Loading DashGen…");
    document
      .querySelector('script[type="module"]')
      ?.dispatchEvent(new Event("error"));
    expect(screen.getByRole("status").textContent).toBe(
      "DashGen couldn't load. Reload the page.",
    );
    // Its chart goes, so nothing looks busy.
    expect(document.querySelector(".loader-failed")).not.toBeNull();
  });

  it("says so too when the page's script fails as it starts, or can't be read", () => {
    load(never);
    window.dispatchEvent(
      new ErrorEvent("error", { message: "Unexpected token '?'" }),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "DashGen couldn't load. Reload the page.",
    );
  });

  it("leaves the loader alone when something else fails to load", () => {
    load(never);
    const image = document.createElement("img");
    document.body.append(image);
    image.dispatchEvent(new Event("error"));
    expect(screen.getByRole("status").textContent).toBe("Loading DashGen…");
  });
});
