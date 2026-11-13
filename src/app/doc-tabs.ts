/**
 * Which tab is open after one is closed. Closing a tab that is not the open one leaves the open one alone; closing
 * the open one opens the tab that took its place (the one to its right), or the last when it was the last. Null when
 * no tab is left.
 */
export function activeAfterClose(order: readonly number[], closed: number, active: number): number | null {
  const at = order.indexOf(closed);
  if (at < 0) return order.includes(active) ? active : (order[0] ?? null);
  const rest = order.filter((id) => id !== closed);
  if (rest.length === 0) return null;
  if (closed !== active) return active;
  return rest[Math.min(at, rest.length - 1)]!;
}

/** The tab order after dropping `closed`. */
export const withoutTab = (order: readonly number[], closed: number): number[] => order.filter((id) => id !== closed);
