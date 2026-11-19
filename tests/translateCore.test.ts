import { describe, expect, it } from 'vitest';
import { SYSTEM_INSTRUCTION } from '../src/shared/translateCore';
import { extractPlaceholders } from '../src/utils/placeholderCheck';

/**
 * The instruction is a prompt, so most of these tests pin its content (a rule that
 * silently disappears is a rule the model no longer follows). The last block goes one
 * step further and checks the examples the prompt shows against the project's own ICU
 * parser, so a documented example can never contradict the checker that judges the reply.
 */
describe('SYSTEM_INSTRUCTION (ICU Phase 2)', () => {
  it('teaches the ICU MessageFormat structure', () => {
    expect(SYSTEM_INSTRUCTION).toContain('ICU MessageFormat');
    for (const keyword of ['plural', 'select', 'selectordinal', 'number', 'date', 'time']) {
      expect(SYSTEM_INSTRUCTION).toContain(keyword);
    }
  });

  it('forbids translating keywords, selectors, offset and #', () => {
    for (const token of ['zero', 'one', 'two', 'few', 'many', 'other', 'offset:', '=0', '#']) {
      expect(SYSTEM_INSTRUCTION).toContain(token);
    }
    expect(SYSTEM_INSTRUCTION).toContain('never translate plural, select, selectordinal, offset:');
    expect(SYSTEM_INSTRUCTION).toContain('an explicit =0/=1 selector');
  });

  it('requires a { } body after every clause keyword', () => {
    // A reply such as `{gender, select, male He other They}` is unparseable at runtime,
    // so the instruction must state the brace requirement, not just "keep the clauses".
    expect(SYSTEM_INSTRUCTION).toContain('Every clause keyword must be followed by its own { } body');
    expect(SYSTEM_INSTRUCTION).toContain('{gender, select, male {He} other {They}} is valid');
    expect(SYSTEM_INSTRUCTION).toContain('{gender, select, male He other They} is not');
  });

  it('requires keeping every clause including other, and never changing format types', () => {
    expect(SYSTEM_INSTRUCTION).toContain('mandatory other clause');
    expect(SYSTEM_INSTRUCTION).toContain('{amount, number} must stay number');
  });

  it('allows adapting plural categories to the target language, but protects other, offset and select keys', () => {
    expect(SYSTEM_INSTRUCTION).toContain('adapt the category set to the target language');
    expect(SYSTEM_INSTRUCTION).toContain('Arabic needs zero, one, two, few, many and other');
    expect(SYSTEM_INSTRUCTION).toContain('Japanese needs only other');
    expect(SYSTEM_INSTRUCTION).toContain('Never remove other');
    expect(SYSTEM_INSTRUCTION).toContain('never change an offset: value');
    expect(SYSTEM_INSTRUCTION).toContain('never add, remove or change select keys');
    // Adding categories is expected, but dropping a source-only one is still a change:
    // the instruction forbids removing `other` and changing select keys, not the rest.
    expect(SYSTEM_INSTRUCTION).toContain('adding a category the target language requires is allowed and expected');
  });

  it('translates words inside quoted literals, keeps the quote marks, and keeps syntax inside them', () => {
    expect(SYSTEM_INSTRUCTION).toContain("A quoted literal '...' is text");
    expect(SYSTEM_INSTRUCTION).toContain("keep every ' exactly as it appears");
    expect(SYSTEM_INSTRUCTION).toContain("''Hello!''");
    expect(SYSTEM_INSTRUCTION).toContain("'{username}' must stay '{username}'");
    // A quoted literal is not a "protect the whole token" marker, so the old wording
    // ("they do not mark text untranslatable" as a single blanket rule) must be gone.
    expect(SYSTEM_INSTRUCTION).not.toContain('do not mark text untranslatable');
  });

  it('shows a plural and a select example', () => {
    expect(SYSTEM_INSTRUCTION).toContain('{count, plural, one {# message} other {# messages}}');
    expect(SYSTEM_INSTRUCTION).toContain('{gender, select, male {He} female {She} other {They}}');
  });

  it('keeps the pre-ICU rules', () => {
    for (const token of ['%1$s', 'Escape sequences', '<b>', '@string/...', '{count}']) {
      expect(SYSTEM_INSTRUCTION).toContain(token);
    }
  });
});

describe('the prompt examples are valid ICU MessageFormat', () => {
  // The project's own extractor is the authority the QA path uses, so if it recognizes the
  // variable, the format type and every clause of a documented example, the example is
  // safe to show the model. (Before this test, `{gender, select, male He ...}` was the
  // documented shape and only looked valid because nothing checked it.)
  it('parses the plural example', () => {
    const tokens = extractPlaceholders('{count, plural, offset:1 =0 {Nobody} one {# message} other {# messages}}');
    expect(tokens).toContain('{count:plural}');
    expect(tokens).toContain('offset:1');
    expect(tokens).toContain('=0');
    expect(tokens).toContain('plural:one');
    expect(tokens).toContain('other');
    expect(tokens).toContain('#');
  });

  it('parses the select example, with braces around every clause', () => {
    const tokens = extractPlaceholders('{gender, select, male {He} female {She} other {They}}');
    expect(tokens).toContain('{gender:select}');
    expect(tokens).toContain('male');
    expect(tokens).toContain('female');
    expect(tokens).toContain('other');
  });
});
