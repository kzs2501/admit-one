/**
 * Server-sent events, read with `fetch`. `EventSource` can't send an `Authorization`
 * header, and putting a token in the URL leaks it into logs and history, so the
 * organisers' stream is read as a plain response body instead. The text format is the
 * same (WHATWG HTML, "Server-sent events"): fields on lines, events ended by a blank
 * line, comments starting with a colon.
 */

export interface StreamEvent {
  /** `message` unless the event named itself. */
  type: string;
  data: string;
  id: string | null;
}

/** An incremental parser: feed it text as it arrives, in chunks of any size, and it calls back once per event. */
export function createEventStreamParser(onEvent: (event: StreamEvent) => void) {
  let buffer = "";
  let type = "";
  let data: string[] = [];
  let id: string | null = null;

  const dispatch = () => {
    if (data.length) onEvent({ type: type || "message", data: data.join("\n"), id });
    type = "";
    data = [];
  };

  const field = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return; // a comment, such as a heartbeat
    const colon = line.indexOf(":");
    const name = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (name === "event") type = value;
    else if (name === "data") data.push(value);
    else if (name === "id") id = value;
  };

  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\r|\n/);
    // The last piece may be half a line; keep it for the next chunk.
    buffer = lines.pop() ?? "";
    for (const line of lines) field(line);
  };
}

/** The stream couldn't be opened; `status` says why (a 401 means the session is over). */
export class StreamError extends Error {
  override readonly name = "StreamError";

  constructor(readonly status: number) {
    super(`The stream answered ${String(status)}.`);
  }
}

/**
 * Read a stream of server-sent events until it ends, the signal aborts, or the
 * connection fails (which rejects, so the caller can reconnect). `onOpen` says when
 * it's connected, before any event has arrived.
 */
export async function readEventStream(
  url: string,
  {
    headers,
    signal,
    onOpen,
    onEvent,
  }: {
    headers: Record<string, string>;
    signal: AbortSignal;
    onOpen?: () => void;
    onEvent: (event: StreamEvent) => void;
  },
): Promise<void> {
  const response = await fetch(url, {
    headers: { ...headers, Accept: "text/event-stream" },
    signal,
    cache: "no-store",
  });
  if (!response.ok || !response.body) throw new StreamError(response.status);
  onOpen?.();
  const parse = createEventStreamParser(onEvent);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done: isDone, value } = await reader.read();
    if (isDone) return;
    parse(value);
  }
}
