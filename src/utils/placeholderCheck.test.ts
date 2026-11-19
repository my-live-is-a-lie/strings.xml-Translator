import { describe, expect, it } from 'vitest';
import {
  analyzeProjectQa,
  extractPlaceholders,
  getItemQaIssues,
  validatePlaceholders,
} from './placeholderCheck';
import { SingleStringItem } from '../types';

// A complete fixture: no `as` cast, so TypeScript checks every required field.
function makeItem(source: string, target: string, name = 'test_string'): SingleStringItem {
  return {
    id: 'i1',
    name,
    type: 'string',
    order: 0,
    status: 'translated',
    source,
    target,
  };
}

const PLURAL_SRC = '{count, plural, one {# book} other {# books}}';
// A grammatically complete Arabic translation (Arabic has 6 plural categories).
const PLURAL_AR_FULL =
  '{count, plural, zero {# كتاب} one {# كتاب} two {# كتابين} few {# كتب} many {# كتابًا} other {# كتاب}}';
// An incomplete Arabic translation: only the English categories (one/other).
const PLURAL_AR_PARTIAL = '{count, plural, one {# كتاب} other {# كتب}}';
// A correct Japanese translation: Japanese has only the `other` category.
const PLURAL_JA = '{count, plural, other {# 冊}}';

describe('extractPlaceholders - simple (non-ICU) placeholders', () => {
  it('matches printf-style format specifiers', () => {
    expect(extractPlaceholders('Hello %s, you have %d items')).toEqual(['%s', '%d']);
  });

  it('matches positional and named bracket placeholders', () => {
    expect(extractPlaceholders('Hi {username}, your code is {0}')).toEqual([
      '{username}',
      '{0}',
    ]);
  });

  it('matches HTML tags', () => {
    expect(extractPlaceholders('<b>bold</b> text')).toEqual(['<b>', '</b>']);
  });

  it('returns an empty array for empty input', () => {
    expect(extractPlaceholders('')).toEqual([]);
  });
});

describe('extractPlaceholders - ICU MessageFormat', () => {
  it('extracts the variable name, format type and plural keywords from a plural block', () => {
    expect(extractPlaceholders('{count, plural, one {# book} other {# books}}')).toEqual([
      '{count}',
      'plural',
      'one',
      '#',
      'other',
    ]);
  });

  it('extracts select keywords and does not confuse them with plain text', () => {
    const found = extractPlaceholders('{gender, select, male {He} female {She} other {They}}');
    expect(found).toEqual(['{gender}', 'select', 'male', 'female', 'other']);
    // The translatable words inside the sub-messages are not placeholders.
    expect(found).not.toContain('He');
    expect(found).not.toContain('She');
    expect(found).not.toContain('They');
  });

  it('extracts selectordinal keywords', () => {
    expect(
      extractPlaceholders('{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}')
    ).toEqual(['{rank}', 'selectordinal', 'one', '#', 'two', 'few', 'other']);
  });

  it('extracts explicit =N matches', () => {
    expect(
      extractPlaceholders('{count, plural, =0 {No items} =1 {One item} other {# items}}')
    ).toEqual(['{count}', 'plural', '=0', '=1', 'other', '#']);
  });

  it('extracts an offset: clause', () => {
    expect(
      extractPlaceholders(
        '{count, plural, offset:1 =0 {No one} =1 {Just you} other {# others}}'
      )
    ).toEqual(['{count}', 'plural', 'offset:1', '=0', '=1', 'other', '#']);
  });

  it('handles nested placeholders inside a plural sub-message', () => {
    expect(
      extractPlaceholders('{count, plural, one {{name} has # book} other {{name} has # books}}')
    ).toEqual(['{count}', 'plural', 'one', '{name}', '#', 'other']);
  });

  it('handles a nested ICU block inside a select clause', () => {
    expect(
      extractPlaceholders(
        '{gender, select, male {{count, plural, one {# book} other {# books}}} other {no books}}'
      )
    ).toEqual(['{gender}', 'select', 'male', '{count}', 'plural', 'one', '#', 'other']);
  });

  it('handles multiple independent ICU blocks in one string', () => {
    expect(
      extractPlaceholders(
        '{gender, select, male {He} other {They}} has {count, plural, one {# item} other {# items}}'
      )
    ).toEqual(['{gender}', 'select', 'male', 'other', '{count}', 'plural', 'one', '#']);
  });

  it('does not treat a bare # outside of a plural/selectordinal clause as a placeholder', () => {
    expect(extractPlaceholders('Rank #1 this week')).not.toContain('#');
  });

  it('extracts number/date format arguments without their style skeletons', () => {
    expect(extractPlaceholders('{n, number, ::currency/USD} and {m, date, short}')).toEqual([
      '{n}',
      '{m}',
    ]);
  });

  it('does not treat plain text like {red, green} as a placeholder', () => {
    expect(extractPlaceholders('Choose {red, green} color')).toEqual([]);
  });

  it('accepts a hyphenated ICU variable name, like a simple placeholder does', () => {
    expect(extractPlaceholders('{user-name, plural, one {# item} other {# items}}')).toEqual([
      '{user-name}',
      'plural',
      'one',
      '#',
      'other',
    ]);
  });

  it('tolerates bidirectional control characters around an ICU variable name', () => {
    expect(
      extractPlaceholders('{\u200Fcount\u200E, plural, one {# book} other {# books}}')
    ).toEqual(['{count}', 'plural', 'one', '#', 'other']);
  });

  it('does not attribute a nested plural offset to the outer block', () => {
    // The outer block has no offset; the `offset:2` belongs to the nested block only.
    expect(
      extractPlaceholders(
        '{count, plural, one {{n, plural, offset:2 one {x} other {y}}} other {z}}'
      )
    ).toEqual(['{count}', 'plural', 'one', '{n}', 'offset:2', 'other']);
  });

  it('documents the known Phase 1 gap: ICU quoted literals are not handled', () => {
    // `'{username}'` is a literal in ICU (the apostrophes quote it), but the
    // parser does not implement `'...'` quoting yet, so it is still read as a
    // placeholder. Update this test when quoting is implemented.
    expect(extractPlaceholders("Say '{username}' out loud")).toEqual(['{username}']);
  });
});

describe('validatePlaceholders', () => {
  it('flags a missing ICU variable/keyword when the target drops the plural structure', () => {
    const result = validatePlaceholders(PLURAL_SRC, 'كتب'); // translator flattened the whole ICU structure away
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toEqual(['{count}', 'plural', 'one', '#', 'other']);
  });

  it('passes when the target preserves the ICU structure with translated sub-messages', () => {
    const result = validatePlaceholders(PLURAL_SRC, PLURAL_AR_PARTIAL);
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
  });

  it('still validates simple {0}/{name} placeholders as before', () => {
    const result = validatePlaceholders('Hi {name}, you have {0} messages', 'مرحبا {name}، لديك {0} رسائل');
    expect(result.valid).toBe(true);
  });

  it('passes a grammatically complete Arabic translation (all 6 categories)', () => {
    const result = validatePlaceholders(PLURAL_SRC, PLURAL_AR_FULL, 'ar');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    // `#` appears once per clause (6 in the target, 2 in the source): its
    // count legitimately differs, so it must not be flagged as extra.
    expect(result.extraInTarget).toEqual([]);
  });

  it('flags the missing categories of an incomplete Arabic translation', () => {
    const result = validatePlaceholders(PLURAL_SRC, PLURAL_AR_PARTIAL, 'ar');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toEqual(['zero', 'two', 'few', 'many']);
    expect(result.extraInTarget).toEqual([]);
  });

  it('passes a correct Japanese translation (only `other`)', () => {
    const result = validatePlaceholders(PLURAL_SRC, PLURAL_JA, 'ja');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.extraInTarget).toEqual([]);
  });

  it('flags categories a Japanese translation does not need as extra (warning, not an error)', () => {
    const result = validatePlaceholders(
      PLURAL_SRC,
      '{count, plural, one {# 冊} few {# 冊} other {# 冊}}',
      'ja'
    );
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.extraInTarget).toEqual(['one', 'few']);
  });

  it('does not double-count a nested offset onto the outer block', () => {
    // Source: outer block has no offset, the nested block has offset:2.
    // Target: outer block gains offset:1, nested block keeps offset:2.
    // The old unanchored regex counted the nested offset twice for the
    // source (once for the outer, once for the nested block) and falsely
    // reported `offset:2` as missing here.
    const src = '{count, plural, one {{n, plural, offset:2 one {x} other {y}}} other {z}}';
    const tgt =
      '{count, plural, offset:1 one {{n, plural, offset:2 one {x} other {y}}} other {z}}';
    const result = validatePlaceholders(src, tgt);
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.extraInTarget).toEqual(['offset:1']);
  });
});

describe('getItemQaIssues - ICU MessageFormat strings', () => {
  it('reports a placeholder error when an ICU plural block is dropped entirely', () => {
    const item = makeItem(PLURAL_SRC, 'كتب', 'book_count');

    const issues = getItemQaIssues(item);
    const placeholderIssue = issues.find((i) => i.category === 'placeholder' && i.severity === 'error');
    expect(placeholderIssue).toBeDefined();
    expect(placeholderIssue?.tokens).toEqual(['{count}', 'plural', 'one', '#', 'other']);
  });

  it('reports no placeholder issue when the ICU structure is correctly preserved', () => {
    const item = makeItem(PLURAL_SRC, PLURAL_AR_PARTIAL, 'book_count');

    const issues = getItemQaIssues(item);
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);
  });

  it('reports unbalanced braces as their own error, not as missing placeholders', () => {
    // The translator dropped the final `}` of the plural block.
    const item = makeItem(PLURAL_SRC, '{count, plural, one {# book} other {# books}', 'book_count');

    const issues = getItemQaIssues(item);
    const bracesIssue = issues.find((i) => i.id.endsWith('_unbalanced_braces'));
    expect(bracesIssue).toBeDefined();
    expect(bracesIssue?.severity).toBe('error');
    expect(issues.some((i) => i.id.endsWith('_missing_ph'))).toBe(false);
  });

  it('reports no placeholder issue for a complete Arabic translation', () => {
    const item = makeItem(PLURAL_SRC, PLURAL_AR_FULL, 'book_count');

    const issues = getItemQaIssues(item, 'ar');
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);
  });

  it('reports missing plural forms for an incomplete Arabic translation', () => {
    const item = makeItem(PLURAL_SRC, PLURAL_AR_PARTIAL, 'book_count');

    const issues = getItemQaIssues(item, 'ar');
    const formsIssue = issues.find((i) => i.id.endsWith('_missing_plural_forms'));
    expect(formsIssue).toBeDefined();
    expect(formsIssue?.severity).toBe('error');
    expect(formsIssue?.tokens).toEqual(['zero', 'two', 'few', 'many']);
  });

  it('reports no placeholder issue for a correct Japanese translation', () => {
    const item = makeItem(PLURAL_SRC, PLURAL_JA, 'book_count');

    const issues = getItemQaIssues(item, 'ja');
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);
  });

  it('reports unexpected plural forms for a Japanese translation as a warning', () => {
    const item = makeItem(
      PLURAL_SRC,
      '{count, plural, one {# 冊} few {# 冊} other {# 冊}}',
      'book_count'
    );

    const issues = getItemQaIssues(item, 'ja');
    const formsIssue = issues.find((i) => i.id.endsWith('_extra_plural_forms'));
    expect(formsIssue).toBeDefined();
    expect(formsIssue?.severity).toBe('warning');
    expect(formsIssue?.tokens).toEqual(['one', 'few']);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });
});

describe('analyzeProjectQa - locale-aware results are not shared across languages', () => {
  it('returns different results for the same item in Arabic and Japanese', () => {
    const item = makeItem(PLURAL_SRC, PLURAL_AR_PARTIAL, 'book_count');

    // Arabic: the partial translation is missing four required categories.
    const ar = analyzeProjectQa([item], 'ar');
    expect(ar.allIssues.some((i) => i.id.endsWith('_missing_plural_forms'))).toBe(true);

    // Japanese: the same target text has an extra `one` (Japanese needs only `other`).
    const ja = analyzeProjectQa([item], 'ja');
    expect(ja.allIssues.some((i) => i.id.endsWith('_missing_plural_forms'))).toBe(false);
    expect(ja.allIssues.some((i) => i.id.endsWith('_extra_plural_forms'))).toBe(true);
  });
});
