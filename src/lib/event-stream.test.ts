import { describe, expect, it } from "vitest";
import { createEventStreamParser, type StreamEvent } from "./event-stream";

const parseAll = (...chunks: string[]) => {
  const events: StreamEvent[] = [];
  const feed = createEventStreamParser((event) => events.push(event));
  for (const chunk of chunks) feed(chunk);
  return events;
};

describe("server-sent events", () => {
  it("reads named events and plain messages, each ended by a blank line", () => {
    expect(parseAll('event: ordersChanged\ndata: {"eventSlugs":["a"]}\n\ndata: hello\n\n')).toEqual([
      { type: "ordersChanged", data: '{"eventSlugs":["a"]}', id: null },
      { type: "message", data: "hello", id: null },
    ]);
  });

  it("puts an event back together across chunks that split it anywhere", () => {
    expect(parseAll("eve", "nt: ping\nda", "ta: 1\n", "\n")).toEqual([{ type: "ping", data: "1", id: null }]);
  });

  it("joins multi-line data, accepts CRLF and CR, and skips comments and empty events", () => {
    expect(parseAll(": heartbeat\r\n\r\ndata: one\rdata: two\r\rid: 7\ndata:x\n\n")).toEqual([
      { type: "message", data: "one\ntwo", id: null },
      { type: "message", data: "x", id: "7" },
    ]);
  });

  it("waits for the blank line before dispatching", () => {
    expect(parseAll("data: not yet\n")).toEqual([]);
  });
});
