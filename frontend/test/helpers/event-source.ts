import type { RunEvent } from "@dashgen/contracts";

/**
 * Stands in for the browser's EventSource, which jsdom doesn't have. Tests
 * play the backend: they send events, or make the stream give up.
 */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  /** Every stream the page opened, oldest first. */
  static opened: FakeEventSource[] = [];

  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.opened.push(this);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  /**
   * The backend sends an event, unless the page closed the stream. Returns
   * whether the page's handler closed the stream itself.
   */
  send(event: RunEvent): boolean {
    if (this.readyState === FakeEventSource.CLOSED) return true;
    this.readyState = FakeEventSource.OPEN;
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(event) }),
    );
    return this.readyState === FakeEventSource.CLOSED;
  }

  /** The connection drops, and EventSource is about to reconnect by itself. */
  drop() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }

  /** EventSource gives up, as it does when the backend answers 404. */
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event("error"));
  }
}

/** The stream the page opened last. */
export function lastStream(): FakeEventSource {
  const stream = FakeEventSource.opened.at(-1);
  if (!stream) throw new Error("The page opened no stream");
  return stream;
}
