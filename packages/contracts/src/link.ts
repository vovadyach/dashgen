// The format of a share link, which carries a chart itself, packed, after the
// address's #. The page opens one with no backend (ADR-0013), and the MCP
// server's create_chart makes them (ADR-0022), so both use this code. It runs
// in browsers and in Node alike.
import type { Chart } from "./index.ts";

/** What a share link's hash starts with. */
export const CHART_LINK_PREFIX = "#chart=";

// A chart is a few KB as JSON, and under half that packed. The caps keep out
// what isn't one of ours, like a small link that unpacks to gigabytes.
const MAX_LINK = 50_000;
const MAX_JSON = 1_000_000;

/**
 * The hash of a link that opens `chart`, like "#chart=…", or undefined when
 * the link would be too long to open: it's held to the same limits as a link
 * that's opened. A chart packed tighter elsewhere could otherwise come back
 * as a link that doesn't open.
 */
export async function chartHash(chart: Chart): Promise<string | undefined> {
  const json = JSON.stringify(chart);
  if (json.length > MAX_JSON) return undefined;
  const hash = `${CHART_LINK_PREFIX}${toBase64Url(await pack(json))}`;
  return hash.length > MAX_LINK ? undefined : hash;
}

/**
 * The JSON in a share link's hash, or undefined for anything else, like a
 * link cut short, or one that unpacks past the cap. Anyone can write a link,
 * so the caller parses the JSON as it would any outside input.
 */
export async function chartJsonFromHash(
  hash: string,
): Promise<string | undefined> {
  if (!hash.startsWith(CHART_LINK_PREFIX) || hash.length > MAX_LINK) {
    return undefined;
  }
  try {
    return await unpack(fromBase64Url(hash.slice(CHART_LINK_PREFIX.length)));
  } catch {
    // Not base64, or not deflate.
    return undefined;
  }
}

async function pack(text: string): Promise<Uint8Array> {
  const packed = new Response(text).body?.pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(packed).arrayBuffer());
}

/** The text in `bytes`, or undefined once it grows past MAX_JSON. */
async function unpack(bytes: Uint8Array<ArrayBuffer>) {
  const unpacked = new Response(bytes).body?.pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  if (!unpacked) return undefined;
  const reader = unpacked.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
    if (text.length > MAX_JSON) {
      await reader.cancel();
      return undefined;
    }
  }
}

// Base64 with - and _ instead of + and /, and no = padding, so a link needs
// no escaping.
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
