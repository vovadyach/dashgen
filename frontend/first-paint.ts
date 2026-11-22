import type { IndexHtmlTransformContext, Plugin } from "vite";

/** A build's output files, by name, as Vite hands them to index.html's transform. */
type Bundle = NonNullable<IndexHtmlTransformContext["bundle"]>;

/**
 * The page's first paint, as early as it can come (ADR-0020): in a build,
 * the page's CSS goes inline in index.html, so no request holds up the
 * paint of its loader.
 */
export function firstPaint(): Plugin {
  return {
    name: "dashgen-first-paint",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html, { bundle }) =>
        bundle ? withInlineCss(html, bundle) : html,
    },
  };
}

/**
 * The page with each of the build's own stylesheets inline, in place of its
 * link. A stylesheet that nothing else loads leaves the build, since the
 * page no longer asks for it.
 */
export function withInlineCss(html: string, bundle: Bundle): string {
  return html.replace(
    /<link rel="stylesheet"[^>]*href="\/([^"]+\.css)"[^>]*>/g,
    (link, fileName: string) => {
      const asset = bundle[fileName];
      if (asset?.type !== "asset") return link;
      const css =
        typeof asset.source === "string"
          ? asset.source
          : new TextDecoder().decode(asset.source);
      // It would end the style element early.
      if (css.includes("</style")) return link;
      const loaded = Object.values(bundle).some(
        (chunk) => chunk.type === "chunk" && chunk.code.includes(fileName),
      );
      if (!loaded) Reflect.deleteProperty(bundle, fileName);
      return `<style>${css}</style>`;
    },
  );
}
