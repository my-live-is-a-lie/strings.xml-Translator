import { describe, it, expect } from 'vitest';
import { computeGroups, orderItems, startingId } from './stringOrder';
import type { ResourceItem } from '../types';

const mk = (id: string, status: string) => ({ id, status }) as unknown as ResourceItem;

describe('stringOrder', () => {
  const items = [mk('a', 'translated'), mk('b', 'needs_review'), mk('c', 'untranslated'), mk('d', 'translated'), mk('e', 'untranslated')];
  it('orders translated, then untranslated, then needs review, keeping file order', () => {
    expect(orderItems(items, computeGroups(items)).map((i) => i.id)).toEqual(['a', 'd', 'c', 'e', 'b']);
  });
  it('starts at the first untranslated string', () => {
    expect(startingId(items)).toBe('c');
  });
  it('starts at the first needs-review string when nothing is untranslated', () => {
    expect(startingId([mk('a', 'translated'), mk('b', 'needs_review')])).toBe('b');
  });
  it('starts at the first string when everything is done', () => {
    expect(startingId([mk('a', 'translated'), mk('b', 'translated')])).toBe('a');
  });
  it('keeps a string where it was when its status changes later', () => {
    const groups = computeGroups(items);
    const changed = items.map((i) => (i.id === 'c' ? mk('c', 'translated') : i));
    expect(orderItems(changed, groups).map((i) => i.id)).toEqual(['a', 'd', 'c', 'e', 'b']);
  });
});
