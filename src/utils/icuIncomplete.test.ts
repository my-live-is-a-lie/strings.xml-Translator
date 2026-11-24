import { describe, it, expect } from 'vitest';
import { getIcuIncompleteIssues } from './placeholderCheck';
import type { ResourceItem } from '../types';

const SOURCE = '{count, plural, one {# message} other {# messages}}';

function str(target: string, source = SOURCE): ResourceItem {
  return { id: 'a', name: 'a', type: 'string', source, target, status: 'translated' } as unknown as ResourceItem;
}

describe('getIcuIncompleteIssues', () => {
  it('flags `one` filled and `other` empty', () => {
    const issues = getIcuIncompleteIssues(str('{count, plural, one {# رسالة} other {}}'), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].messageEn).toContain('{count}: other');
  });

  it('flags `other` filled and `one` empty', () => {
    const issues = getIcuIncompleteIssues(str('{count, plural, one {} other {# رسائل}}'), 'hi');
    expect(issues).toHaveLength(1);
    expect(issues[0].messageEn).toContain('{count}: one');
  });

  it('passes when every field is filled', () => {
    expect(getIcuIncompleteIssues(str('{count, plural, one {# رسالة} other {# رسائل}}'), 'hi')).toEqual([]);
  });

  it('does not flag categories the target language adds', () => {
    expect(getIcuIncompleteIssues(str('{count, plural, one {# رسالة} other {# رسائل}}'), 'ar')).toEqual([]);
  });

  it('flags an empty text run around the block', () => {
    const src = 'You have {count, plural, one {# message} other {# messages}}';
    const issues = getIcuIncompleteIssues(str('{count, plural, one {a} other {b}}', src), 'hi');
    expect(issues.map((i) => i.messageEn).join()).toContain('text');
  });

  it('does not flag an untranslated (empty) target', () => {
    expect(getIcuIncompleteIssues(str(''), 'ar')).toEqual([]);
  });

  it('does not require a field whose source is empty', () => {
    expect(getIcuIncompleteIssues(str('{count, plural, one {a} other {}}', '{count, plural, one {x} other {}}'), 'ar')).toEqual([]);
  });

  it('finds an empty field in a nested block', () => {
    const src = '{g, select, male {{n, plural, one {a} other {b}}} other {c}}';
    const issues = getIcuIncompleteIssues(str('{g, select, male {{n, plural, one {x} other {}}} other {z}}', src), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].messageEn).toContain('{n}: other');
  });

  it('ignores plain strings', () => {
    expect(getIcuIncompleteIssues(str('مرحبا', 'Hello'), 'ar')).toEqual([]);
  });

  it('flags a <plurals> resource with any quantity of the target language empty', () => {
    const item = {
      id: 'p', name: 'p', type: 'plural', status: 'translated',
      items: [
        { quantity: 'one', source: 'a', target: 'x' },
        { quantity: 'other', source: 'b', target: 'z' },
      ],
    } as unknown as ResourceItem;
    const issues = getIcuIncompleteIssues(item, 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].messageEn).toContain('few');
  });

  it('flags a <plurals> resource whose other is empty (Hindi: one and other only)', () => {
    const item = {
      id: 'p', name: 'p', type: 'plural', status: 'translated',
      items: [{ quantity: 'one', source: 'a', target: 'x' }, { quantity: 'other', source: 'b', target: '' }],
    } as unknown as ResourceItem;
    expect(getIcuIncompleteIssues(item, 'hi')).toHaveLength(1);
  });

  it('passes a <plurals> resource with all quantities filled, or nothing translated', () => {
    const mk = (t: string) =>
      ({ id: 'p', name: 'p', type: 'plural', status: 'translated', items: [
        { quantity: 'one', source: 'a', target: t }, { quantity: 'other', source: 'b', target: t } ] }) as unknown as ResourceItem;
    expect(getIcuIncompleteIssues(mk('x'), 'hi')).toEqual([]);
    expect(getIcuIncompleteIssues(mk(''), 'ar')).toEqual([]);
  });
});
