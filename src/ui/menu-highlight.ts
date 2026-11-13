/**
 * The highlighted row of a menu panel. There is exactly one: the row under the mouse. It is kept in a class rather
 * than left to CSS :hover, which can stay on a row the pointer has already crossed (and then two rows look
 * selected). Leaving the panel keeps only the row `keep()` names (the one whose sub-menu is open). Touch and pen
 * give no hover, so they never leave a row lit.
 */
export function trackHighlight(panel: HTMLElement, keep: () => HTMLElement | null = () => null): (row: HTMLElement | null) => void {
  const highlight = (row: HTMLElement | null): void => {
    for (const r of panel.querySelectorAll('.menu-item.active')) if (r !== row) r.classList.remove('active');
    row?.classList.add('active');
  };
  panel.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.menu-item');
    if (row && panel.contains(row)) highlight(row);
  });
  panel.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') highlight(keep());
  });
  return highlight;
}
