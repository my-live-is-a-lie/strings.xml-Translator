import { describe, it, expect } from 'vitest';
import { availableTypeFilters, applyQuickFilters } from './quickFilters';
import { ResourceItem } from '../types';

const s = (id: string) => ({ id, name: id, type: 'string', source: 'a', target: '', status: 'untranslated', order: 0 }) as ResourceItem;
const p = (id: string) => ({ id, name: id, type: 'plural', quantities: [], status: 'untranslated', order: 0 }) as unknown as ResourceItem;
const a = (id: string) => ({ id, name: id, type: 'array', items: [], status: 'untranslated', order: 0 }) as unknown as ResourceItem;

describe('type filters', () => {
  it('strings + plurals -> plural only', () => expect(availableTypeFilters([s('1'), p('2')])).toEqual(['plural']));
  it('strings + arrays -> array only', () => expect(availableTypeFilters([s('1'), a('2')])).toEqual(['array']));
  it('all three -> both', () => expect(availableTypeFilters([s('1'), p('2'), a('3')])).toEqual(['plural', 'array']));
  it('plurals + arrays without strings -> both', () => expect(availableTypeFilters([p('2'), a('3')])).toEqual(['plural', 'array']));
  it('single kind -> none', () => {
    expect(availableTypeFilters([s('1')])).toEqual([]);
    expect(availableTypeFilters([p('1')])).toEqual([]);
    expect(availableTypeFilters([a('1')])).toEqual([]);
  });
  it('filters by type', () => {
    const items = [s('1'), p('2'), a('3')];
    expect(applyQuickFilters(items, ['plural']).map((i) => i.id)).toEqual(['2']);
    expect(applyQuickFilters(items, ['plural', 'array']).map((i) => i.id)).toEqual(['2', '3']);
  });
});
