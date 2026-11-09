import { ResourceItem } from '../types';

/** Display order: 0 = translated, 1 = untranslated, 2 = changed in the source / needs review. */
export type OrderGroup = 0 | 1 | 2;

export function groupOf(item: Pick<ResourceItem, 'status'>): OrderGroup {
  return item.status === 'untranslated' ? 1 : item.status === 'needs_review' ? 2 : 0;
}

/** Group of every string at this moment. Kept for the whole session so strings don't jump while translating. */
export function computeGroups(items: readonly ResourceItem[]): Record<string, OrderGroup> {
  const out: Record<string, OrderGroup> = {};
  for (const it of items) out[it.id] = groupOf(it);
  return out;
}

/** Translated first, then untranslated, then needs-review; the file order is kept inside each group. */
export function orderItems(items: ResourceItem[], groups: Record<string, OrderGroup>): ResourceItem[] {
  return items
    .map((it, idx) => ({ it, idx, g: groups[it.id] ?? groupOf(it) }))
    .sort((a, b) => a.g - b.g || a.idx - b.idx)
    .map((x) => x.it);
}

/**
 * Where the editor opens after a fresh start: the first untranslated string, then the first one needing review;
 * when nothing is left to do, the first string of the file.
 */
export function startingId(items: ResourceItem[]): string {
  const ordered = orderItems(items, computeGroups(items));
  const first = ordered.find((i) => groupOf(i) !== 0) ?? items[0];
  return first?.id ?? '';
}
