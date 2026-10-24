// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, readText } from "./kit";

/** A body that arrives in chunks, with no Content-Length, counting how many were read. */
function streamedBody(chunkCount: number, chunk: Uint8Array) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunkCount) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(chunk);
    },
  });
  const request = new Request("https://admit-one.test/api/holds", {
    method: "POST",
    body,
    // Node's fetch needs this for a streamed body.
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => pulled };
}

describe("reading a request body", () => {
  it("stops reading a streamed body once it's over the limit, with no Content-Length to go on", async () => {
    // 1 MB in 16 KB chunks: the limit is passed at the fifth.
    const { request, pulled } = streamedBody(64, new Uint8Array(16 * 1024).fill(0x61));
    expect(request.headers.get("Content-Length")).toBeNull();
    expect(await readText(request)).toBeNull();
    expect(pulled()).toBeLessThanOrEqual(Math.ceil(MAX_BODY_BYTES / (16 * 1024)) + 1);
  });

  it("reads a body within the limit whole, a character split across chunks included", async () => {
    const rupee = new TextEncoder().encode("₹"); // three bytes
    const chunks = [rupee.slice(0, 1), rupee.slice(1)];
    let next = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[next++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const request = new Request("https://admit-one.test/api/holds", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(await readText(request)).toBe("₹");
  });

  it("reads an empty body as empty", async () => {
    expect(await readText(new Request("https://admit-one.test/api/holds", { method: "POST" }))).toBe("");
  });
});
