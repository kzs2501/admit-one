// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSlidingWindow } from "./rate-limit";

const LIMIT = { limit: 3, windowMs: 10_000 };

function setup() {
  let nowMs = 0;
  const window = createSlidingWindow(() => nowMs);
  return {
    take: () => window.take(LIMIT),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("sliding-window rate limit", () => {
  it("allows the limit, then says exactly how long until the next request may go", () => {
    const { take, advance } = setup();
    for (let i = 0; i < 3; i++) {
      expect(take()).toEqual({ isAllowed: true });
      advance(1_000);
    }
    // Arrivals at 0, 1 and 2 s, and this refused one at 3 s, which counts too. Fewer
    // than three remain once the second arrival leaves the window: at 11 s, 8 s away.
    expect(take()).toEqual({ isAllowed: false, retryAfterMs: 8_000 });
  });

  it("slides: a request is allowed as soon as an old one ages out — no boundary bursts", () => {
    const { take, advance } = setup();
    take();
    advance(5_000);
    take();
    take();
    advance(4_999);
    expect(take().isAllowed).toBe(false); // 9.999 s: the first is still in the window
    advance(5_001);
    // 15 s: everything at or before 5 s has aged out; only the refused try remains.
    expect(take().isAllowed).toBe(true);
  });

  it("counts refusals, so hammering keeps a client waiting and obeying Retry-After gets straight in", () => {
    const hammering = setup();
    for (let i = 0; i < 3; i++) hammering.take(); // three at 0 s fill the window
    for (let i = 0; i < 10; i++) {
      hammering.advance(1_000);
      hammering.take(); // refused at 1, 2, … 10 s
    }
    hammering.advance(500);
    // 10.5 s: the three at 0 s have aged out — but the refusals since haven't.
    expect(hammering.take().isAllowed).toBe(false);

    const patient = setup();
    for (let i = 0; i < 3; i++) patient.take();
    const first = patient.take();
    if (first.isAllowed) throw new Error("expected a refusal");
    patient.advance(first.retryAfterMs);
    expect(patient.take().isAllowed).toBe(true);
  });
});
