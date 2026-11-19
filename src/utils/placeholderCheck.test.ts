import { describe, expect, it } from 'vitest';
import { extractPlaceholders, getItemQaIssues, validatePlaceholders } from './placeholderCheck';
import { ResourceItem } from '../types';

describe('extractPlaceholders - simple (non-ICU) placeholders', () => {
  it('matches printf-style format specifiers', () => {
    expect(extractPlaceholders('Hello %s, you have %d items')).toEqual(
      expect.arrayContaining(['%s', '%d'])
    );
  });

  it('matches positional and named bracket placeholders', () => {
    const found = extractPlaceholders('Hi {username}, your code is {0}');
    expect(found).toEqual(expect.arrayContaining(['{username}', '{0}']));
  });

  it('matches HTML tags', () => {
    expect(extractPlaceholders('<b>bold</b> text')).toEqual(expect.arrayContaining(['<b>', '</b>']));
  });

  it('returns an empty array for empty input', () => {
    expect(extractPlaceholders('')).toEqual([]);
  });
});

describe('extractPlaceholders - ICU MessageFormat', () => {
  it('extracts the variable name, format type and plural keywords from a plural block', () => {
    const found = extractPlaceholders('{count, plural, one {# book} other {# books}}');
    expect(found).toEqual(
      expect.arrayContaining(['{count}', 'plural', 'one', 'other', '#'])
    );
  });

  it('extracts select keywords and does not confuse them with plain text', () => {
    const found = extractPlaceholders('{gender, select, male {He} female {She} other {They}}');
    expect(found).toEqual(
      expect.arrayContaining(['{gender}', 'select', 'male', 'female', 'other'])
    );
    // The translatable words inside the sub-messages are not placeholders.
    expect(found).not.toEqual(expect.arrayContaining(['He', 'She', 'They']));
  });

  it('extracts selectordinal keywords', () => {
    const found = extractPlaceholders('{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}');
    expect(found).toEqual(
      expect.arrayContaining(['{rank}', 'selectordinal', 'one', 'two', 'few', 'other', '#'])
    );
  });

  it('extracts explicit =N matches', () => {
    const found = extractPlaceholders('{count, plural, =0 {No items} =1 {One item} other {# items}}');
    expect(found).toEqual(expect.arrayContaining(['{count}', 'plural', '=0', '=1', 'other']));
  });

  it('extracts an offset: clause', () => {
    const found = extractPlaceholders(
      '{count, plural, offset:1 =0 {No one} =1 {Just you} other {# others}}'
    );
    expect(found).toEqual(expect.arrayContaining(['{count}', 'plural', 'offset:1', '=0', '=1', 'other']));
  });

  it('handles nested placeholders inside a plural sub-message', () => {
    const found = extractPlaceholders('{count, plural, one {{name} has # book} other {{name} has # books}}');
    expect(found).toEqual(expect.arrayContaining(['{count}', 'plural', 'one', 'other', '{name}', '#']));
  });

  it('handles multiple independent ICU blocks in one string', () => {
    const found = extractPlaceholders(
      '{gender, select, male {He} other {They}} has {count, plural, one {# item} other {# items}}'
    );
    expect(found).toEqual(
      expect.arrayContaining(['{gender}', 'select', '{count}', 'plural', 'one', 'other'])
    );
  });

  it('does not treat a bare # outside of a plural/selectordinal clause as a placeholder', () => {
    const found = extractPlaceholders('Rank #1 this week');
    expect(found).not.toEqual(expect.arrayContaining(['#']));
  });
});

describe('validatePlaceholders', () => {
  it('flags a missing ICU variable/keyword when the target drops the plural structure', () => {
    const result = validatePlaceholders(
      '{count, plural, one {# book} other {# books}}',
      'كتب' // translator flattened the whole ICU structure away
    );
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toEqual(expect.arrayContaining(['{count}', 'plural']));
  });

  it('passes when the target preserves the ICU structure with translated sub-messages', () => {
    const result = validatePlaceholders(
      '{count, plural, one {# book} other {# books}}',
      '{count, plural, one {# كتاب} other {# كتب}}'
    );
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
  });

  it('still validates simple {0}/{name} placeholders as before', () => {
    const result = validatePlaceholders('Hi {name}, you have {0} messages', 'مرحبا {name}، لديك {0} رسائل');
    expect(result.valid).toBe(true);
  });
});

describe('getItemQaIssues - ICU MessageFormat strings', () => {
  it('reports a placeholder error when an ICU plural block is dropped entirely', () => {
    const item: ResourceItem = {
      id: 'i1',
      name: 'book_count',
      type: 'string',
      source: '{count, plural, one {# book} other {# books}}',
      target: 'كتب',
    } as ResourceItem;

    const issues = getItemQaIssues(item);
    const placeholderIssue = issues.find((i) => i.category === 'placeholder' && i.severity === 'error');
    expect(placeholderIssue).toBeDefined();
    expect(placeholderIssue?.tokens).toEqual(expect.arrayContaining(['{count}', 'plural']));
  });

  it('reports no placeholder issue when the ICU structure is correctly preserved', () => {
    const item: ResourceItem = {
      id: 'i2',
      name: 'book_count',
      type: 'string',
      source: '{count, plural, one {# book} other {# books}}',
      target: '{count, plural, one {# كتاب} other {# كتب}}',
    } as ResourceItem;

    const issues = getItemQaIssues(item);
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);
  });
});
