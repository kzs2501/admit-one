/**
 * Which rows a virtualised table keeps in the DOM: the ones in view (plus overscan),
 * and the one with keyboard focus, wherever it is. Without that, scrolling a focused
 * row out of view would delete it, and focus would fall back to the page.
 */
export function withFocusedRow(visible: readonly number[], focusedIndex: number | null): number[] {
  if (focusedIndex === null || visible.includes(focusedIndex)) return [...visible];
  return [...visible, focusedIndex].sort((left, right) => left - right);
}

/**
 * The empty space above and below the rows that are drawn. Spacer rows hold it, so the
 * table keeps its native layout — and its semantics — instead of positioning rows
 * absolutely. A gap between the visible rows and a far-off focused one gets a spacer too.
 */
export function spacers(drawn: readonly { index: number; start: number; end: number }[], totalSize: number) {
  const gaps: { beforeIndex: number | null; height: number }[] = [];
  let edge = 0;
  for (const row of drawn) {
    if (row.start > edge) gaps.push({ beforeIndex: row.index, height: row.start - edge });
    edge = row.end;
  }
  if (totalSize > edge) gaps.push({ beforeIndex: null, height: totalSize - edge });
  return gaps;
}
