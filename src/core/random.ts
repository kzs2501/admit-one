/**
 * Deterministic randomness, for data that should look varied but be the same on every
 * run: the seats already sold, the order history. Tests and screenshots see the same
 * world every time.
 */

/** mulberry32: a tiny seeded generator returning numbers in [0, 1). */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
