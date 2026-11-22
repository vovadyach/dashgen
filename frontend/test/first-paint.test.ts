import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { withInlineCss } from "../first-paint.ts";

// From disk, by path: Vitest empties CSS imports, even raw ones.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url).pathname, "utf8");
const html = read("../index.html");
const css = read("../src/index.css");

type Bundle = Parameters<typeof withInlineCss>[1];

const LINK = '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">';
const page = (head: string) => `<html><head>${head}</head><body></body></html>`;

/** A build with a stylesheet and a script, as Vite hands it over. */
const bundle = (styles: string, code = "console.log(1)") =>
  ({
    "assets/index-abc.css": { type: "asset", source: styles },
    "assets/index-xyz.js": { type: "chunk", code },
  }) as unknown as Bundle;

describe("the page's first paint", () => {
  it("puts the page's own CSS inline, and drops the file nothing loads now", () => {
    const build = bundle("body{margin:0}");
    expect(withInlineCss(page(LINK), build)).toBe(
      page("<style>body{margin:0}</style>"),
    );
    expect(Object.keys(build)).toEqual(["assets/index-xyz.js"]);
  });

  it("keeps the file that a script loads", () => {
    const build = bundle("body{margin:0}", 'load("assets/index-abc.css")');
    expect(withInlineCss(page(LINK), build)).toBe(
      page("<style>body{margin:0}</style>"),
    );
    expect(Object.keys(build)).toContain("assets/index-abc.css");
  });

  it("leaves a link alone when it isn't the build's, or its CSS would end the style element", () => {
    const elsewhere = '<link rel="stylesheet" href="/other.css">';
    expect(withInlineCss(page(elsewhere), bundle("a{}"))).toBe(page(elsewhere));
    expect(withInlineCss(page(LINK), bundle('a{content:"</style>"}'))).toBe(
      page(LINK),
    );
  });
});

describe("index.html's loader", () => {
  it("is in #root, where React replaces it: a line, bars and a pie, like a pinned card's", () => {
    const root = /<div id="root">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1];
    expect(root).toContain('<div class="loader">');
    for (const chart of ["loader-line", "loader-bar", "loader-slice"]) {
      expect(root).toContain(`class="${chart}`);
    }
  });

  it("has the page's own colors, in both themes", () => {
    const color = (theme: string, name: string) =>
      new RegExp(`${theme} \\{[^}]*--${name}: (#\\w+);`).exec(css)?.[1] ??
      "missing";
    const rule = (selector: string) =>
      new RegExp(`\\n {6}${selector} \\{([^}]*)\\}`).exec(html)?.[1];
    for (const [page, ink, theme] of [
      ["html", "\\.loader", ":root"],
      ["html\\.dark", "\\.dark \\.loader", ".dark"],
    ] as const) {
      expect(rule(page)).toContain(
        `background: ${color(theme, "background")};`,
      );
      // On the loader itself: in a build, the page's CSS sets the body's.
      expect(rule(ink)).toContain(
        `color: ${color(theme, "muted-foreground")};`,
      );
    }
    // The accent, the same in both themes.
    expect(/\.loader-dot \{[^}]*fill: (#\w+);/.exec(html)?.[1]).toBe(
      color(":root", "primary"),
    );
  });
});
