/** A price tier's fill on the seat map: 1 for the dearest (brass), then 2 (jade) and 3 (lapis). */
export type TierTone = 1 | 2 | 3;

const TONES = [1, 2, 3] as const;

/**
 * Tones by price, dearest first, so the map and its legend agree on which colour is
 * which tier. A hall with more than three tiers gives the cheaper ones the third tone;
 * the legend still names every tier in words.
 */
export function tierTones(tiers: readonly { id: string; priceMinor: number }[]): ReadonlyMap<string, TierTone> {
  const byPrice = [...tiers].sort((left, right) => right.priceMinor - left.priceMinor);
  return new Map(byPrice.map((tier, index) => [tier.id, TONES[index] ?? 3]));
}
