// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyQuickFilters, applyQuickSnapshot, quickFilterCounts } from '../src/utils/quickFilters';
import type { ResourceItem } from '../src/types';

const mk = (name: string, status: string, src?: 'ai' | 'manual') =>
  ({ id: name, name, type: 'string', source: name, target: status === 'untranslated' ? '' : 'x', status, translationSource: src }) as unknown as ResourceItem;

const items = [
  mk('u', 'untranslated'),
  mk('ai', 'translated', 'ai'),
  mk('man', 'translated', 'manual'),
  mk('plain', 'translated'),
];
const names = (f: Parameters<typeof applyQuickFilters>[1]) => applyQuickFilters(items, f).map((i) => i.name);

describe('quick filters', () => {
  it('shows everything with no filter', () => expect(names([])).toEqual(['u', 'ai', 'man', 'plain']));
  it('single filters', () => {
    expect(names(['untranslated'])).toEqual(['u']);
    expect(names(['translated'])).toEqual(['ai', 'man', 'plain']);
    expect(names(['ai'])).toEqual(['ai']);
    expect(names(['manual'])).toEqual(['man', 'plain']);
  });
  it('ORs within a group', () => {
    expect(names(['untranslated', 'translated'])).toEqual(['u', 'ai', 'man', 'plain']);
    expect(names(['ai', 'manual'])).toEqual(['ai', 'man', 'plain']);
  });
  it('ANDs across groups', () => {
    expect(names(['translated', 'ai'])).toEqual(['ai']);
    expect(names(['untranslated', 'ai'])).toEqual([]);
  });

  it('counts what each filter could show', () => {
    expect(quickFilterCounts(items)).toEqual({ untranslated: 1, translated: 3, ai: 1, manual: 2 });
    expect(quickFilterCounts([mk('u', 'untranslated')])).toMatchObject({ ai: 0, manual: 0, translated: 0 });
  });

  it('keeps a saved string in the view while the snapshot is fixed', () => {
    const snapshot = new Set(applyQuickFilters(items, ['untranslated']).map((i) => i.id));
    const after = items.map((i) => (i.id === 'u' ? ({ ...i, status: 'translated', target: 'x' } as ResourceItem) : i));
    expect(applyQuickSnapshot(after, { active: ['untranslated'], snapshot }).map((i) => i.name)).toEqual(['u']);
    expect(applyQuickSnapshot(after, { active: ['untranslated'], snapshot: null })).toEqual([]);
  });
});
