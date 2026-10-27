/** Scrolls the visible element that carries data-item-id=<id> into view; returns whether one was found. */
export function scrollItemIntoView(root: ParentNode, id: string, block: ScrollLogicalPosition = 'center'): boolean {
  const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  const nodes = root.querySelectorAll<HTMLElement>(`[data-item-id="${safe}"]`);
  for (const el of Array.from(nodes)) {
    if (el.offsetParent !== null) {
      el.scrollIntoView({ block, behavior: 'auto' });
      return true;
    }
  }
  return false;
}
