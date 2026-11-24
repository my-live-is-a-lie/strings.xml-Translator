import { describe, it, expect } from 'vitest';
import { getIcuEmptyOtherIssues } from './placeholderCheck';
import type { ResourceItem } from '../types';

const SOURCE = '{count, plural, one {# message} other {# messages}}';

function str(target: string, source = SOURCE): ResourceItem {
  return { id: 'a', name: 'a', type: 'string', source, target, status: 'translated' } as unknown as ResourceItem;
}

describe('getIcuEmptyOtherIssues', () => {
  it('warns when only `one` is filled and `other` is empty', () => {
    const issues = getIcuEmptyOtherIssues(str('{count, plural, one {# رسالة} other {}}'), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].messageEn).toContain('{count}');
  });

  it('does not warn when both are filled', () => {
    expect(getIcuEmptyOtherIssues(str('{count, plural, one {# رسالة} other {# رسائل}}'), 'ar')).toEqual([]);
  });

  it('does not warn for an untranslated (empty) target', () => {
    expect(getIcuEmptyOtherIssues(str(''), 'ar')).toEqual([]);
  });

  it('does not warn when the source `other` is empty too', () => {
    expect(getIcuEmptyOtherIssues(str('{count, plural, one {a} other {}}', '{count, plural, one {x} other {}}'), 'ar')).toEqual([]);
  });

  it('finds an empty `other` in a nested block', () => {
    const src = '{g, select, male {{n, plural, one {a} other {b}}} other {c}}';
    const issues = getIcuEmptyOtherIssues(str('{g, select, male {{n, plural, one {x} other {}}} other {z}}', src), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].messageEn).toContain('{n}');
  });

  it('ignores plain strings', () => {
    expect(getIcuEmptyOtherIssues(str('مرحبا', 'Hello'), 'ar')).toEqual([]);
  });
});
