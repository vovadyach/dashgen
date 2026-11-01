import { Chart } from "@dashgen/contracts";

// A share link carries the chart itself, compressed, after the address's #.
// Browsers never send that part to a server, so a link needs no backend,
// and it still opens after the AWS stack is torn down (ADR-0013).
const PREFIX = "#chart=";

// A chart is a few KB as JSON, and under half that packed. The caps keep out
// what isn't one of ours, like a small link that unpacks to gigabytes.
const MAX_LINK = 50_000;
const MAX_JSON = 1_000_000;

/** Whether an address's hash, like `location.hash`, is a share link. */
export const isChartLink = (hash: string) => hash.startsWith(PREFIX);

/**
 * A link to this page that opens `chart`, with no run, or undefined when the
 * link would be too long to open: it's held to the same limits as a link
 * that's opened. A chart from a link packed tighter than this page packs
 * could otherwise come back as one that doesn't open.
 */
export async function chartLink(chart: Chart): Promise<string | undefined> {
  const json = JSON.stringify(chart);
  if (json.length > MAX_JSON) return undefined;
  const hash = `${PREFIX}${toBase64Url(await pack(json))}`;
  if (hash.length > MAX_LINK) return undefined;
  return `${location.origin}${location.pathname}${hash}`;
}

/**
 * The chart in a share link's hash. Anyone can write a link, so what it
 * carries is parsed like the backend's answers, and anything else, like a
 * link cut short, gives undefined.
 */
export async function chartFromLink(hash: string): Promise<Chart | undefined> {
  if (!isChartLink(hash) || hash.length > MAX_LINK) return undefined;
  try {
    const json = await unpack(fromBase64Url(hash.slice(PREFIX.length)));
    if (json === undefined) return undefined;
    const parsed = Chart.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Not base64, not deflate, or not JSON.
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
