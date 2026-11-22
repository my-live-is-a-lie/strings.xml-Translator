import type { ResourceItem } from '../types';
import { describe, expect, it } from 'vitest';
import {
  analyzeProjectQa,
  extractPlaceholders,
  getItemQaIssues,
  findClauseBodyOpens,
  findUnpairedQuoteMark,
  fixUnpairedQuoteMarks,
  repairItemQuoteMarks,
  getIcuStructureIssues,
  hasMultilineIcuBlock,
  itemUsesHashWithoutClauseNumber,
  splitIcuBlocks,
  usesHashWithoutClauseNumber,
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
      '{count:plural}',
      'plural:one',
      '#',
      'other',
    ]);
  });

  it('extracts select keywords and does not confuse them with plain text', () => {
    const found = extractPlaceholders('{gender, select, male {He} female {She} other {They}}');
    expect(found).toEqual(['{gender:select}', 'male', 'female', 'other']);
    // The translatable words inside the sub-messages are not placeholders.
    expect(found).not.toContain('He');
    expect(found).not.toContain('She');
    expect(found).not.toContain('They');
  });

  it('extracts selectordinal keywords', () => {
    expect(
      extractPlaceholders('{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}')
    ).toEqual([
      '{rank:selectordinal}',
      'selectordinal:one',
      '#',
      'selectordinal:two',
      'selectordinal:few',
      'other',
    ]);
  });

  it('extracts explicit =N matches', () => {
    expect(
      extractPlaceholders('{count, plural, =0 {No items} =1 {One item} other {# items}}')
    ).toEqual(['{count:plural}', '=0', '=1', 'other', '#']);
  });

  it('extracts an offset: clause', () => {
    expect(
      extractPlaceholders(
        '{count, plural, offset:1 =0 {No one} =1 {Just you} other {# others}}'
      )
    ).toEqual(['{count:plural}', 'offset:1', '=0', '=1', 'other', '#']);
  });

  it('handles nested placeholders inside a plural sub-message', () => {
    expect(
      extractPlaceholders('{count, plural, one {{name} has # book} other {{name} has # books}}')
    ).toEqual(['{count:plural}', 'plural:one', '{name}', '#', 'other']);
  });

  it('handles a nested ICU block inside a select clause', () => {
    expect(
      extractPlaceholders(
        '{gender, select, male {{count, plural, one {# book} other {# books}}} other {no books}}'
      )
    ).toEqual(['{gender:select}', 'male', '{count:plural}', 'plural:one', '#', 'other']);
  });

  it('handles multiple independent ICU blocks in one string', () => {
    expect(
      extractPlaceholders(
        '{gender, select, male {He} other {They}} has {count, plural, one {# item} other {# items}}'
      )
    ).toEqual(['{gender:select}', 'male', 'other', '{count:plural}', 'plural:one', '#']);
  });

  it('does not treat a bare # outside of a plural/selectordinal clause as a placeholder', () => {
    expect(extractPlaceholders('Rank #1 this week')).not.toContain('#');
  });

  it('extracts number/date format arguments with their type but without their style skeletons', () => {
    // The format type (`number`, `date`) is part of the placeholder — a
    // change in type must be reported — but the style (`::currency/USD`,
    // `short`) is not compared.
    expect(extractPlaceholders('{n, number, ::currency/USD} and {m, date, short}')).toEqual([
      '{n:number}',
      '{m:date}',
    ]);
  });

  it('does not treat plain text like {red, green} as a placeholder', () => {
    expect(extractPlaceholders('Choose {red, green} color')).toEqual([]);
  });

  it('accepts a hyphenated ICU variable name, like a simple placeholder does', () => {
    expect(extractPlaceholders('{user-name, plural, one {# item} other {# items}}')).toEqual([
      '{user-name:plural}',
      'plural:one',
      '#',
      'other',
    ]);
  });

  it('tolerates bidirectional control characters around an ICU variable name', () => {
    expect(
      extractPlaceholders('{\u200Fcount\u200E, plural, one {# book} other {# books}}')
    ).toEqual(['{count:plural}', 'plural:one', '#', 'other']);
  });

  it('does not attribute a nested plural offset to the outer block', () => {
    // The outer block has no offset; the `offset:2` belongs to the nested block only.
    expect(
      extractPlaceholders(
        '{count, plural, one {{n, plural, offset:2 one {x} other {y}}} other {z}}'
      )
    ).toEqual(['{count:plural}', 'plural:one', '{n:plural}', 'offset:2', 'other']);
  });

  it('treats ICU quoted literals as literal text, not placeholders', () => {
    // `'{username}'` is a literal in ICU (the apostrophes quote it), so it is
    // not a placeholder. An apostrophe inside a word (e.g. `it's`) is not a
    // quote boundary, so a `{` after it is still structure.
    expect(extractPlaceholders("Say '{username}' out loud")).toEqual([]);
    expect(extractPlaceholders("it's {fine}")).toEqual(['{fine}']);
  });
});

describe('validatePlaceholders', () => {
  it('flags a missing ICU variable/keyword when the target drops the plural structure', () => {
    const result = validatePlaceholders(PLURAL_SRC, 'كتب'); // translator flattened the whole ICU structure away
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toEqual(['{count:plural}', 'plural:one', '#', 'other']);
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

  it('reports the missing categories of an incomplete Arabic translation as warnings', () => {
    // Missing categories are warnings, not errors: ICU only mandates `other`,
    // so the translation is still valid — the categories are reported in
    // `warnings`, not in `missingInTarget`.
    const result = validatePlaceholders(PLURAL_SRC, PLURAL_AR_PARTIAL, 'ar');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.extraInTarget).toEqual([]);
    expect(result.warnings).toEqual(['zero', 'two', 'few', 'many']);
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
    expect(result.extraInTarget).toEqual([]);
    expect(result.warnings).toEqual(['one', 'few']);
  });

  it('flags a dropped HTML tag (restored after the count-based change)', () => {
    // The count-based `validatePlaceholders` only returned printf + ICU
    // tokens, so a dropped `<b>` was silently missed by the AI-reply check.
    const result = validatePlaceholders('<b>x</b>', 'x');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toEqual(['<b>', '</b>']);
  });

  it('flags a dropped literal `%%`', () => {
    const result = validatePlaceholders('100%% done', '100 done');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toEqual(['%%']);
  });

  it('accepts an Android-format locale (pt-rBR) for Brazilian Portuguese', () => {
    // The app stores target languages in Android format (`pt-rBR`), which
    // `Intl.PluralRules` rejects; the locale is normalized to BCP 47 first.
    // pt-BR needs one/many/other.
    const result = validatePlaceholders(
      PLURAL_SRC,
      '{count, plural, one {# livro} many {# livros} other {# livros}}',
      'pt-rBR'
    );
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.extraInTarget).toEqual([]);
  });

  it('accepts an Android-format locale (zh-rCN) for Chinese', () => {
    // zh-CN needs only `other`.
    const result = validatePlaceholders(
      PLURAL_SRC,
      '{count, plural, other {# 本}}',
      'zh-rCN'
    );
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.extraInTarget).toEqual([]);
  });

  it('falls back to the plain comparison for an unsupported locale', () => {
    // `zz` is well-formed but unsupported: `Intl.PluralRules` would silently
    // return the default locale's categories, so it is rejected and the
    // plain source/target comparison is used instead.
    const result = validatePlaceholders(PLURAL_SRC, PLURAL_AR_FULL, 'zz');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    // The order of the extra tokens is an implementation detail of the
    // structural comparison, so compare the set, not the order. A different
    // number of `#` is no longer a token difference: a language with more
    // plural forms writes more of them, and the numeral is often
    // ungrammatical in one form (Arabic one/two), so the count is not
    // compared at all — only a block that lost its `#` entirely, and that is
    // reported by `compareMessages` as a warning.
    expect([...result.extraInTarget].sort()).toEqual(
      ['plural:zero', 'plural:two', 'plural:few', 'plural:many'].sort()
    );
  });

  it('accepts an Arabic plural that writes # in only some of its six forms', () => {
    // Arabic says `كتاب واحد` / `كتابان` for one and two: the numeral is ungrammatical there,
    // so a correct translation has FEWER `#` than the English source. The old whole-message
    // count called this a damaged block, and the save gate refused to save it.
    const arFew = '{count, plural, zero {لا كتب} one {كتاب واحد} two {كتابان} few {# كتب} many {# كتابًا} other {# كتاب}}';
    const result = validatePlaceholders(PLURAL_SRC, arFew, 'ar');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.warnings).toEqual([]);

    // More `#` than the source is fine too: Arabic writes six forms where English writes two.
    const arAll = '{count, plural, zero {# كتاب} one {# كتاب} two {# كتابين} few {# كتب} many {# كتابًا} other {# كتاب}}';
    expect(validatePlaceholders(PLURAL_SRC, arAll, 'ar').valid).toBe(true);
  });

  it('does not accept a block that lost its # altogether', () => {
    // The number silently disappears from the sentence — a real finding, reported as a warning
    // so the user sees it without the save being blocked (some languages do spell it out).
    const noHash = '{count, plural, one {كتاب} other {كتب}}';
    const result = validatePlaceholders(PLURAL_SRC, noHash, 'ar');
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('#');
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
    expect(placeholderIssue?.tokens).toEqual(['{count:plural}', 'plural:one', '#', 'other']);
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

  it('does not flag an unbalanced SOURCE (a lone brace there is ordinary text)', () => {
    // The source has a stray `}` (`:-}`); that is the developer's text, not
    // the translator's fault, so it must not raise an error.
    const item = makeItem('Smile :-}', 'ابتسم :-)', 'smile');

    const issues = getItemQaIssues(item);
    expect(issues.some((i) => i.id.endsWith('_unbalanced_braces'))).toBe(false);
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);
  });

  it('does not flag a quoted brace (a valid ICU literal)', () => {
    const item = makeItem("Say '{' now", "قل '{' الآن", 'say');

    const issues = getItemQaIssues(item);
    expect(issues.some((i) => i.id.endsWith('_unbalanced_braces'))).toBe(false);
  });

  it('still reports a dropped %s when the target has unbalanced braces', () => {
    // The target drops both the final `}` and the `%s`: the braces error is
    // reported, but the printf comparison still runs.
    const item = makeItem(
      'You have %s messages {count, plural, one {# book} other {# books}}',
      'لديك رسائل {count, plural, one {# كتاب} other {# كتب}',
      'msg_count'
    );

    const issues = getItemQaIssues(item);
    expect(issues.some((i) => i.id.endsWith('_unbalanced_braces'))).toBe(true);
    const missing = issues.find((i) => i.id.endsWith('_missing_ph'));
    expect(missing).toBeDefined();
    expect(missing?.tokens).toEqual(['%s']);
  });

  it('reports no placeholder issue for a complete Arabic translation', () => {
    const item = makeItem(PLURAL_SRC, PLURAL_AR_FULL, 'book_count');

    const issues = getItemQaIssues(item, 'ar');
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);
  });

  it('reports missing plural forms for an incomplete Arabic translation as a warning', () => {
    const item = makeItem(PLURAL_SRC, PLURAL_AR_PARTIAL, 'book_count');

    const issues = getItemQaIssues(item, 'ar');
    const formsIssue = issues.find((i) => i.id.endsWith('_missing_plural_forms'));
    expect(formsIssue).toBeDefined();
    // ICU only mandates `other` (a missing category falls back to it), so a
    // missing category is a quality issue, not an export-blocking error.
    expect(formsIssue?.severity).toBe('warning');
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

describe('regression tests - round-3 and round-4 reviews', () => {
  it('flags a block that lost its other clause even when the global other count is unchanged', () => {
    // Block `b` lost its `other`, block `a` gained a duplicate one: the
    // global `other` count is still 2, so only the per-block check catches it.
    const src = '{a, plural, one {#} other {#}} {b, plural, one {#} other {#}}';
    const tgt = '{a, plural, one {#} other {#} other {#}} {b, plural, one {#}}';
    const item = makeItem(src, tgt, 'two_blocks');

    const issues = getItemQaIssues(item, 'en');
    const otherIssue = issues.find((i) => i.id.endsWith('_missing_other'));
    expect(otherIssue).toBeDefined();
    expect(otherIssue?.severity).toBe('error');
    expect(otherIssue?.tokens).toEqual(['other:{b}']);

    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('other:{b}');
  });

  it('does not flag a nested placeholder that only appears in a dropped clause', () => {
    // Japanese needs only `other`; `{name}` is preserved in the `other`
    // clause that will actually display, so it is not missing.
    const src = '{n, plural, one {{name} has # book} other {{name} has # books}}';
    const tgt = '{n, plural, other {{name}の本は#冊です}}';
    const item = makeItem(src, tgt, 'book_count');

    const issues = getItemQaIssues(item, 'ja');
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);

    const result = validatePlaceholders(src, tgt, 'ja');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
  });

  it('flags a deleted select key even when a plural block has the same keyword', () => {
    // The `select` key `one` is deleted, but `plural:one` still exists, so
    // the namespaced tokens keep them apart.
    const src = '{g, select, one {A} other {B}} | {n, plural, one {# x} other {# y}}';
    const tgt = '{g, select, other {B}} | {n, plural, one {# x} other {# y}}';
    const item = makeItem(src, tgt, 'mixed');

    const issues = getItemQaIssues(item, 'en');
    const missing = issues.find((i) => i.id.endsWith('_missing_ph'));
    expect(missing).toBeDefined();
    expect(missing?.tokens).toContain('select:one');

    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('select:one');
  });

  it('does not flag a select key named one as a plural category', () => {
    // A `select` block whose key is `one` is not a plural category, so it
    // must not be excluded by the locale-aware comparison.
    const src = '{mode, select, one {Single} other {Default}}';
    const tgt = '{mode, select, other {Default}}';
    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('select:one');
  });

  it('does not produce false missing placeholders for a quoted brace inside a real ICU block', () => {
    const src = '{n, plural, other {# {name}}}';
    const tgt = "{n, plural, other {'{' # {name}}}";
    const item = makeItem(src, tgt, 'quoted');

    const issues = getItemQaIssues(item, 'ja');
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);

    const result = validatePlaceholders(src, tgt, 'ja');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
  });

  it('does not flag a target that preserves the source literal braces', () => {
    // The source itself has a stray `}` (`:-}`); the target faithfully
    // preserving it is not an error.
    const item = makeItem('Press {} :-}', 'اضغط {} :-}', 'press');
    const issues = getItemQaIssues(item, 'ar');
    expect(issues.some((i) => i.id.endsWith('_unbalanced_braces'))).toBe(false);
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);
  });

  it('flags a stray { hidden between apostrophes', () => {
    // The `'` in `it's` and `don't` are literal apostrophes, not ICU quote
    // boundaries, so the `{` is unbalanced and must be reported.
    const item = makeItem("it's fine, don't worry", "it's { fine, don't worry", 'fine');
    const issues = getItemQaIssues(item, 'en');
    expect(issues.some((i) => i.id.endsWith('_unbalanced_braces'))).toBe(true);
  });

  it('flags a change in the ICU format type (number to date)', () => {
    const src = '{amount, number, ::currency/USD}';
    const tgt = '{amount, date, short}';
    const item = makeItem(src, tgt, 'amount');

    const issues = getItemQaIssues(item, 'en');
    expect(issues.some((i) => i.category === 'placeholder')).toBe(true);

    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('{amount:number}');
    expect(result.extraInTarget).toContain('{amount:date}');
  });

  it('flags an appended unbalanced brace in the AI-reply check too', () => {
    // Appending ` {` leaves the token counts unchanged, but the target is
    // malformed ICU (`U_UNMATCHED_BRACES`), so the AI check must flag it the
    // same way QA does.
    const src = '{n, plural, other {# {name}}}';
    const tgt = '{n, plural, other {# {name}}} {';
    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('{');
  });

  it('does not treat a missing plural category as an error in the AI-reply check', () => {
    // A missing category is a warning in QA, so `validatePlaceholders` must
    // not report it as invalid either — it belongs in `warnings`.
    const src = '{n, plural, one {# book} other {# books}}';
    const tgt = '{n, plural, zero{#} one{#} two{#} few{#} other{#}}';
    const result = validatePlaceholders(src, tgt, 'ar');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.warnings).toEqual(['many']);
  });
});

describe('regression tests - round-5 review', () => {
  it('flags a type swap between two variables (name and type are one token)', () => {
    // `{price, number} {when, date}` → `{price, date} {when, number}` has
    // the same flat token sets, so the variable name and the format type are
    // compared as one token (`{name:type}`).
    const src = '{price, number} {when, date}';
    const tgt = '{price, date} {when, number}';
    const item = makeItem(src, tgt, 'swap');

    const issues = getItemQaIssues(item, 'en');
    expect(issues.some((i) => i.category === 'placeholder')).toBe(true);

    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('{price:number}');
    expect(result.missingInTarget).toContain('{when:date}');
    expect(result.extraInTarget).toContain('{price:date}');
    expect(result.extraInTarget).toContain('{when:number}');
  });

  it('flags an added ICU block that lacks an other clause', () => {
    // Block `b` does not exist in the source at all, so it is not excused by
    // a source block that itself lacks `other` — ICU requires `other` in
    // every block.
    const src = '{a, select, male {A} other {B}}';
    const tgt = '{a, select, male {A} other {B}} {b, select, male {C}}';
    const item = makeItem(src, tgt, 'added');

    const issues = getItemQaIssues(item, 'en');
    const missingOther = issues.find((i) => i.id.endsWith('_missing_other'));
    expect(missingOther).toBeDefined();
    expect(missingOther?.severity).toBe('error');
    expect(missingOther?.tokens).toContain('other:{b}');

    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('other:{b}');
  });

  it('flags a deleted placeholder outside the plural block, even with a locale', () => {
    // The second `{name}` is plain text, not inside a plural branch, so it
    // is compared by count — the presence of a plural block elsewhere in the
    // message must not hide its deletion.
    const src = 'Hello {name}. {n, plural, one {# item} other {# items}} Bye {name}';
    const tgt = 'Hello {name}. {n, plural, one {# item} other {# items}} Bye';
    const item = makeItem(src, tgt, 'name');

    const issues = getItemQaIssues(item, 'en');
    expect(issues.some((i) => i.id.endsWith('_missing_ph'))).toBe(true);

    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('{name}');
  });

  it('flags a deleted select key in one block, even when another block keeps it', () => {
    // `male` is deleted from block `a` only; its presence in block `b` must
    // not cover the deletion, even though the message also has a plural block.
    const src =
      '{a, select, male {A} other {B}} {b, select, male {C} other {D}} {n, plural, one {#} other {#}}';
    const tgt =
      '{a, select, other {B}} {b, select, male {C} other {D}} {n, plural, one {#} other {#}}';
    const item = makeItem(src, tgt, 'select');

    const issues = getItemQaIssues(item, 'en');
    expect(issues.some((i) => i.id.endsWith('_missing_ph'))).toBe(true);

    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('male');
  });

  it('warns about a missing plural category in one block, naming the block', () => {
    // Block `a` has `one` and `other`; block `b` has only `other`. The
    // category in `a` must not hide its absence in `b`.
    const src = '{a, plural, one {#} other {#}} {b, plural, one {#} other {#}}';
    const tgt = '{a, plural, one {#} other {#}} {b, plural, other {#}}';
    const item = makeItem(src, tgt, 'blocks');

    const issues = getItemQaIssues(item, 'en');
    const formsIssue = issues.find((i) => i.id.endsWith('_missing_plural_forms'));
    expect(formsIssue).toBeDefined();
    expect(formsIssue?.severity).toBe('warning');
    expect(formsIssue?.tokens).toContain('one');
    expect(formsIssue?.messageEn).toContain('{b}');
  });

  it('does not reject a literal brace in a non-ICU target', () => {
    // Neither the source nor the target uses ICU, so a lone `}` in the target
    // is ordinary literal text in an Android resource, not a broken block.
    const item = makeItem('Hello world', 'Hello world :-}', 'hello');
    const issues = getItemQaIssues(item, 'en');
    expect(issues.some((i) => i.id.endsWith('_unbalanced_braces'))).toBe(false);
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);

    const result = validatePlaceholders('Hello world', 'Hello world :-}', 'en');
    expect(result.valid).toBe(true);
  });

  it('still flags a missing closing brace in a real ICU block', () => {
    // The restriction above must not let a broken ICU block pass: deleting
    // the final `}` of a plural block is still an error.
    const src = '{n, plural, one {#} other {#}}';
    const tgt = '{n, plural, one {#} other {#}';
    const item = makeItem(src, tgt, 'brace');
    const issues = getItemQaIssues(item, 'en');
    expect(issues.some((i) => i.id.endsWith('_unbalanced_braces'))).toBe(true);
  });

  it('does not reject a Japanese target that drops a plural clause with %s', () => {
    // The two `%s` in the source are in mutually exclusive branches; the
    // Japanese target keeps only the `other` branch, so one `%s` is enough.
    const src = '{n, plural, one {%s item} other {%s items}}';
    const tgt = '{n, plural, other {%s items}}';
    const item = makeItem(src, tgt, 'printf');

    const issues = getItemQaIssues(item, 'ja');
    expect(issues.some((i) => i.category === 'placeholder')).toBe(false);

    const result = validatePlaceholders(src, tgt, 'ja');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
  });

  it('still flags a %s dropped from the kept plural branch', () => {
    const src = '{n, plural, one {%s item} other {%s items}}';
    const tgt = '{n, plural, other {items}}';
    const result = validatePlaceholders(src, tgt, 'ja');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('%s');
  });

  it('flags a dropped repeated HTML tag in the AI check, as QA does', () => {
    // Tags are compared by count even when a plural block exists: the
    // leniency for dropped plural clauses must not cover a tag repeated in
    // plain text.
    const src = '<b>A</b> <b>B</b> {n, plural, one {#} other {#}}';
    const tgt = '<b>A B</b> {n, plural, one {#} other {#}}';
    const item = makeItem(src, tgt, 'tags');

    const issues = getItemQaIssues(item, 'en');
    expect(issues.some((i) => i.category === 'html')).toBe(true);

    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('<b>');
    expect(result.missingInTarget).toContain('</b>');
  });

  it('does not flag reordering two sound arguments', () => {
    // Reordering is allowed; it must not look like a type swap or a missing
    // placeholder.
    const src = '{price, number} {when, date}';
    const tgt = '{when, date} {price, number}';
    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(true);
    expect(result.missingInTarget).toEqual([]);
    expect(result.extraInTarget).toEqual([]);
  });
});

describe('structural comparison - nested blocks and repeated variables', () => {
  it('compares a select block nested inside a plural clause by structure', () => {
    // A nested block is compared in its own clause, not flattened into the
    // message-wide count: deleting its `male` key is caught even though a
    // `male` key exists in an outer select block.
    const src =
      '{n, plural, one {{g, select, male {He} other {They}} has # book} other {{g, select, male {He} other {They}} have # books}}';
    const tgt =
      '{n, plural, one {{g, select, other {They}} has # book} other {{g, select, male {He} other {They}} have # books}}';
    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('male');
  });

  it('flags a nested block that lost its other clause', () => {
    const src = '{g, select, male {{n, plural, one {#} other {#}}} other {X}}';
    const tgt = '{g, select, male {{n, plural, one {#}}} other {X}}';
    const item = makeItem(src, tgt, 'nested_other');
    const issues = getItemQaIssues(item, 'en');
    const otherIssue = issues.find((i) => i.id.endsWith('_missing_other'));
    expect(otherIssue).toBeDefined();
    expect(otherIssue?.severity).toBe('error');
    expect(otherIssue?.tokens).toContain('other:{n}');
  });

  it('matches repeated blocks with the same variable by position', () => {
    // Two blocks with the same variable name: the first target block matches
    // the first source block, the second matches the second. A missing
    // `other` in the second block is reported for that block, not hidden by
    // the first block's `other`.
    const src = '{n, plural, one {#} other {#}} {n, plural, one {#} other {#}}';
    const tgt = '{n, plural, one {#} other {#}} {n, plural, one {#}}';
    const item = makeItem(src, tgt, 'repeated');
    const issues = getItemQaIssues(item, 'en');
    const otherIssue = issues.find((i) => i.id.endsWith('_missing_other'));
    expect(otherIssue).toBeDefined();
    expect(otherIssue?.tokens).toContain('other:{n}');
  });

  it('reports a dropped whole block with its contents, not just the block', () => {
    const src = 'Hello {name}. {n, plural, one {# item} other {# items}}';
    const tgt = 'Hello {name}.';
    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('{n:plural}');
    expect(result.missingInTarget).toContain('plural:one');
    expect(result.missingInTarget).toContain('other');
  });

  it('reports an added whole block with its contents', () => {
    const src = 'Hello {name}.';
    const tgt = 'Hello {name}. {n, plural, one {# item} other {# items}}';
    const result = validatePlaceholders(src, tgt, 'en');
    expect(result.valid).toBe(true);
    expect(result.extraInTarget).toContain('{n:plural}');
    expect(result.extraInTarget).toContain('plural:one');
  });
});

describe('findClauseBodyOpens', () => {
  it('marks clause bodies in select and plural blocks, not plain placeholders', () => {
    const src = 'Hi {name}, {gender, select, male {He} other {They}}';
    const opens = [...findClauseBodyOpens(src)].map((i) => src.slice(i, i + 5));
    expect(opens).toEqual(['{He} ', '{They']);
    // `{name}` is an argument, not a clause body.
    expect([...findClauseBodyOpens(src)].some((i) => src.startsWith('{name}', i))).toBe(false);
  });

  it('finds clauses nested inside other clauses', () => {
    // `male {{n, plural, ...}}`: the first `{` opens the clause body, the second starts the
    // nested argument, so the body's own offset is the outer brace (ICU needs both).
    const src = '{g, select, male {{n, plural, one {# book} other {# books}}} other {none}}';
    const bodies = [...findClauseBodyOpens(src)].map((i) => src.slice(i, i + 9));
    expect(bodies).toContain('{{n, plur');
    expect(bodies).toContain('{# book} ');
    expect(bodies).toContain('{# books}');
    expect(bodies).toContain('{none}}');
    // Every reported offset really is a `{`.
    for (const i of findClauseBodyOpens(src)) expect(src[i]).toBe('{');
  });

  it('ignores braces inside a quoted literal', () => {
    const src = "{gender, select, male {'{not a clause}'} other {x}}";
    expect([...findClauseBodyOpens(src)]).toHaveLength(2);
  });

  it('returns nothing for a string with no ICU block', () => {
    expect(findClauseBodyOpens('Hi {name}, you have {0} messages').size).toBe(0);
  });
});

describe('hasMultilineIcuBlock', () => {
  it('reports a block whose braces are separated by a line break', () => {
    expect(hasMultilineIcuBlock('{count, plural,\n one {# a} other {# b}}')).toBe(true);
    expect(hasMultilineIcuBlock('{count, plural, one {# a}\n other {# b}}')).toBe(true);
  });

  it('does not report a single-line block, plain text, or braces in a quoted literal', () => {
    expect(hasMultilineIcuBlock('{count, plural, one {# a} other {# b}}')).toBe(false);
    expect(hasMultilineIcuBlock('a\nb')).toBe(false);
    expect(hasMultilineIcuBlock("x '{not\nstructure' y")).toBe(false);
  });
});

describe('getIcuStructureIssues (save gate)', () => {
  const item = (target: string, source = '{count, plural, one {# m} other {# ms}}'): ResourceItem =>
    ({ id: 'x', name: 'inbox', type: 'string', order: 0, status: 'translated', source, target } as ResourceItem);

  it('reports a hand-typed block that would crash at runtime', () => {
    const issues = getIcuStructureIssues(item('{count, plural, one {# رسالة}}'), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].id).toContain('icu_structure');
  });

  it('accepts a correct block', () => {
    expect(getIcuStructureIssues(item('{count, plural, one {# رسالة} other {# رسائل}}'), 'ar')).toEqual([]);
  });

  it('ignores strings without an ICU block, so placeholder repair is untouched', () => {
    expect(getIcuStructureIssues(item('لا يوجد {name}', 'Hi {name}'), 'ar')).toEqual([]);
  });

  it('ignores an empty target (nothing typed yet)', () => {
    expect(getIcuStructureIssues(item(''), 'ar')).toEqual([]);
  });

  it('catches a translated format type', () => {
    expect(getIcuStructureIssues(item('{count, ترتيبي, one {#} other {#}}'), 'ar')).toHaveLength(1);
  });

  it('names the quantity that is broken in a plurals item', () => {
    const plural: ResourceItem = {
      id: 'p',
      name: 'p',
      type: 'plural',
      order: 0,
      status: 'translated',
      items: [
        { quantity: 'one', source: '{n, plural, one {# a} other {# as}}', target: '{n, plural, one {# أ}}' },
        { quantity: 'other', source: '{n, plural, one {# a} other {# as}}', target: '{n, plural, one {# أ} other {# أس}}' },
      ],
    } as ResourceItem;
    expect(getIcuStructureIssues(plural, 'ar').map((i) => i.subKey)).toEqual(['one']);
  });
});

describe('splitIcuBlocks - Phase 3 per-clause translation', () => {
  it('splits a select block from its surrounding text with body spans', () => {
    const parts = splitIcuBlocks('{gender, select, male {He} female {She} other {They}} liked your post');
    expect(parts).toHaveLength(2);
    expect(parts?.[0].kind).toBe('block');
    expect(parts?.[0].text).toBe('{gender, select, male {He} female {She} other {They}}');
    expect(parts?.[0].bodies?.map((b) => parts[0].text.slice(b.start, b.end))).toEqual([
      'He',
      'She',
      'They',
    ]);
    expect(parts?.[1]).toEqual({ kind: 'text', text: ' liked your post' });
  });

  it('returns a lone plural block as a single part', () => {
    const parts = splitIcuBlocks('{count, plural, one {# message} other {# messages}}');
    expect(parts).toHaveLength(1);
    expect(parts?.[0].kind).toBe('block');
    expect(parts?.[0].bodies?.map((b) => parts[0].text.slice(b.start, b.end))).toEqual([
      '# message',
      '# messages',
    ]);
  });

  it('skips the offset: prefix when finding plural bodies', () => {
    const parts = splitIcuBlocks('{count, plural, offset: 1 one {# message} other {# messages}}');
    expect(parts?.[0].bodies?.map((b) => parts[0].text.slice(b.start, b.end))).toEqual([
      '# message',
      '# messages',
    ]);
  });

  it('returns only the outer block when a body hides a nested block', () => {
    const parts = splitIcuBlocks(
      '{gender, select, male {He has {count, plural, one {# message} other {# messages}}} other {They}}'
    );
    expect(parts).toHaveLength(1);
    expect(parts?.[0].bodies?.map((b) => parts[0].text.slice(b.start, b.end))).toEqual([
      'He has {count, plural, one {# message} other {# messages}}',
      'They',
    ]);
  });

  it('returns null for plain text and for plain placeholders', () => {
    expect(splitIcuBlocks('Hello world')).toBeNull();
    expect(splitIcuBlocks('Hi {name}, you have %d messages')).toBeNull();
  });

  it('ignores a block inside quotes', () => {
    expect(splitIcuBlocks("'{gender, select, male {He}}'")).toBeNull();
  });
});

describe('doubled braces do not pass the structural check', () => {
  const SELECT = '{gender, select, male {He} female {She} other {They}} liked your post';

  it('rejects {{He}} even with the keywords intact', () => {
    const doubled = '{gender, select, male {{He}} female {{She}} other {{They}}} أعجبهم منشورك';
    expect(validatePlaceholders(SELECT, doubled, 'ar').valid).toBe(false);
  });

  it('still accepts a correct translation with translated clause text', () => {
    const good = '{gender, select, male {هو} female {هي} other {هم}} أعجبهم منشورك';
    expect(validatePlaceholders(SELECT, good, 'ar').valid).toBe(true);
  });

  it('rejects a doubled plain placeholder too', () => {
    expect(validatePlaceholders('Hi {name}', 'مرحبا {{name}}', 'ar').valid).toBe(false);
  });
});

describe('usesHashWithoutClauseNumber / itemUsesHashWithoutClauseNumber - the # warning line', () => {
  it('fires when the number vanished from a block that counts something', () => {
    const noHash = '{count, plural, one {كتاب} other {كتب}}';
    expect(usesHashWithoutClauseNumber(PLURAL_SRC, noHash, 'ar')).toBe(true);
    expect(itemUsesHashWithoutClauseNumber(makeItem(PLURAL_SRC, noHash), 'ar')).toBe(true);
  });

  it('stays quiet for a correct Arabic plural that writes # in fewer forms', () => {
    // The sentence still shows the number in `few`/`many`/`other`; one/two spell it out.
    const arFew =
      '{count, plural, zero {لا كتب} one {كتاب واحد} two {كتابان} few {# كتب} many {# كتابًا} other {# كتاب}}';
    expect(usesHashWithoutClauseNumber(PLURAL_SRC, arFew, 'ar')).toBe(false);
    expect(itemUsesHashWithoutClauseNumber(makeItem(PLURAL_SRC, arFew), 'ar')).toBe(false);
  });

  it('stays quiet when nothing counts anything', () => {
    expect(usesHashWithoutClauseNumber('Hello', 'مرحبا', 'ar')).toBe(false);
    expect(usesHashWithoutClauseNumber('Hi {name}', 'مرحبا {name}', 'ar')).toBe(false);
    // An untranslated string has nothing to warn about yet.
    expect(usesHashWithoutClauseNumber(PLURAL_SRC, '', 'ar')).toBe(false);
  });

  it('does not fire for plural-category warnings alone', () => {
    // Only `one`/`other` where Arabic needs six: a category warning, not a lost number.
    const partial = '{count, plural, one {# كتاب} other {# كتب}}';
    expect(validatePlaceholders(PLURAL_SRC, partial, 'ar').warnings.length).toBeGreaterThan(0);
    expect(usesHashWithoutClauseNumber(PLURAL_SRC, partial, 'ar')).toBe(false);
  });

  it('checks every part of a plurals/array item', () => {
    const item = {
      id: 'p1',
      name: 'items',
      type: 'plural' as const,
      status: 'translated' as const,
      order: 0,
      items: [
        { quantity: 'one' as const, source: '{n, plural, one {# x} other {# xs}}', target: '{n, plural, one {# س} other {# سس}}' },
        { quantity: 'other' as const, source: '{n, plural, one {# y} other {# ys}}', target: '{n, plural, one {ص} other {صص}}' },
      ],
    };
    expect(itemUsesHashWithoutClauseNumber(item, 'ar')).toBe(true);
  });
});

describe('findUnpairedQuoteMark', () => {
  it('accepts balanced quote pairs', () => {
    expect(findUnpairedQuoteMark("'{username}' said: ''Hello!''")).toBeNull();
    expect(findUnpairedQuoteMark('said "Hello!" loudly')).toBeNull();
    expect(findUnpairedQuoteMark('لا علامات هنا')).toBeNull();
  });
  it('flags a deleted half of a doubled apostrophe pair', () => {
    expect(findUnpairedQuoteMark("''Hello!'")).toBe('apostrophe');
  });
  it('flags an unpaired straight double quote', () => {
    expect(findUnpairedQuoteMark('said "Hello!')).toBe('double_quote');
  });
  it('ignores contractions between letters', () => {
    expect(findUnpairedQuoteMark("it's fine")).toBeNull();
  });
  it('treats a balanced pair of quoting apostrophes as paired', () => {
    expect(findUnpairedQuoteMark("قال 'مرحبا'")).toBeNull();
    expect(findUnpairedQuoteMark("قال 'مرحبا")).toBe('apostrophe');
  });
  it('ignores an apostrophe with no quote characters at all', () => {
    expect(findUnpairedQuoteMark('plain text')).toBeNull();
    expect(findUnpairedQuoteMark('')).toBeNull();
  });
});

describe('getIcuStructureIssues quote pairs (save gate)', () => {
  const item = (target: string, source = "'{username}' said: ''Hello!''"): ResourceItem =>
    ({ id: 'x', name: 'quoted_message', type: 'string', order: 0, status: 'translated', source, target } as ResourceItem);

  it('blocks a target with a broken doubled-apostrophe pair', () => {
    const issues = getIcuStructureIssues(item("'{username}' قال: ''مرحبا!'"), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toContain('quote_pair');
  });

  it('blocks a target with an unpaired double quote', () => {
    const issues = getIcuStructureIssues(item('"{username}" قال: "مرحبا!'), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toContain('quote_pair');
  });

  it('accepts the correctly quoted form', () => {
    expect(getIcuStructureIssues(item("'{username}' قال: ''مرحبا!''"), 'ar')).toEqual([]);
  });

  it('still catches an unterminated ICU quote first', () => {
    const issues = getIcuStructureIssues(item("'{username} قال: ''مرحبا!''"), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toContain('icu_quote');
  });
});

describe('validatePlaceholders with apostrophe-quoted placeholders', () => {
  const source = "'{username}' said: ''Hello!''";

  it('accepts a reply that keeps the quoting', () => {
    expect(validatePlaceholders(source, "قال '{username}': ''مرحبا!''", 'ar').valid).toBe(true);
  });

  it('accepts a reply that dropped the apostrophe quoting but kept the placeholder', () => {
    expect(validatePlaceholders(source, 'قال {username}: مرحبا!', 'ar').valid).toBe(true);
  });

  it('still requires the quoted placeholder to be present', () => {
    const r = validatePlaceholders(source, 'قال: مرحبا!', 'ar');
    expect(r.valid).toBe(false);
    expect(r.missingInTarget).toContain('{username}');
  });
});

describe('fixUnpairedQuoteMarks', () => {
  it('completes a broken doubled-apostrophe pair', () => {
    expect(fixUnpairedQuoteMarks("'{username}' قال: ''مرحبا!'")).toBe("'{username}' قال: ''مرحبا!''");
  });
  it('completes an unpaired double quote', () => {
    expect(fixUnpairedQuoteMarks('قال "مرحبا!')).toBe('قال "مرحبا!"');
  });
  it('closes an unterminated ICU quote', () => {
    expect(fixUnpairedQuoteMarks("'{username} said")).toBe("'{username} said'");
  });
  it('leaves balanced text untouched', () => {
    expect(fixUnpairedQuoteMarks("'{username}' said: ''Hello!''")).toBe("'{username}' said: ''Hello!''");
    expect(fixUnpairedQuoteMarks("it's fine")).toBe("it's fine");
  });
});

describe('repairItemQuoteMarks', () => {
  it('repairs the target of a string item', () => {
    const item = { id: 'x', name: 'n', type: 'string', order: 0, status: 'translated', source: 'a', target: 'قال "مرحبا!' } as ResourceItem;
    const r = repairItemQuoteMarks(item);
    expect(r.changed).toBe(true);
    expect((r.item as { target: string }).target).toBe('قال "مرحبا!"');
  });
  it('reports unchanged when nothing is broken', () => {
    const item = { id: 'x', name: 'n', type: 'string', order: 0, status: 'translated', source: 'a', target: 'مرحبا' } as ResourceItem;
    expect(repairItemQuoteMarks(item).changed).toBe(false);
  });
});

describe('fixUnpairedQuoteMarks with trailing whitespace and source context', () => {
  const source = "'{username}' said: ''Hello!''";

  it('inserts the missing mark before trailing formatting whitespace', () => {
    expect(fixUnpairedQuoteMarks("قال '{username}': ''مرحبًا!'\n    ", source)).toBe(
      "قال '{username}': ''مرحبًا!''\n    "
    );
  });

  it('restores a deleted closing pair using the source ending', () => {
    expect(fixUnpairedQuoteMarks("قال '{username}': ''مرحبًا!", source)).toBe(
      "قال '{username}': ''مرحبًا!''"
    );
  });

  it('does not touch a target that kept all quote marks, even reordered', () => {
    expect(fixUnpairedQuoteMarks("''مرحبًا!'' قال '{username}'", source)).toBe(
      "''مرحبًا!'' قال '{username}'"
    );
  });

  it('does not force quotes on a quote-free translation', () => {
    expect(fixUnpairedQuoteMarks('قال مرحبا', source)).toBe('قال مرحبا');
  });

  it('still repairs without a source argument', () => {
    expect(fixUnpairedQuoteMarks('قال "مرحبا!')).toBe('قال "مرحبا!"');
  });
});

describe('getIcuStructureIssues missing closing quotes (save gate)', () => {
  const item = (target: string): ResourceItem =>
    ({ id: 'x', name: 'quoted_message', type: 'string', order: 0, status: 'translated', source: "'{username}' said: ''Hello!''", target } as ResourceItem);

  it('flags a deleted closing pair', () => {
    const issues = getIcuStructureIssues(item("قال '{username}': ''مرحبًا!"), 'ar');
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toContain('quote_pair');
  });

  it('accepts a reordered translation that kept every mark', () => {
    expect(getIcuStructureIssues(item("''مرحبًا!'' قال '{username}'"), 'ar')).toEqual([]);
  });

  it('accepts a quote-free translation', () => {
    expect(getIcuStructureIssues(item('قال مرحبا'), 'ar')).toEqual([]);
  });
});

describe('fixUnpairedQuoteMarks in stored form (literal \\n edges)', () => {
  const storedSource = String.raw`\n        '{username}' said: ''Hello!''\n    `;

  it('inserts the missing mark before the stored-form trailing edge', () => {
    const broken = String.raw`\n        قال '{username}': ''مرحبًا!'\n    `;
    expect(fixUnpairedQuoteMarks(broken, storedSource)).toBe(
      String.raw`\n        قال '{username}': ''مرحبًا!''\n    `
    );
  });

  it('restores a deleted closing pair in stored form', () => {
    const broken = String.raw`\n        قال '{username}': ''مرحبًا!\n    `;
    expect(fixUnpairedQuoteMarks(broken, storedSource)).toBe(
      String.raw`\n        قال '{username}': ''مرحبًا!''\n    `
    );
  });
});
