import { describe, expect, it } from 'vitest';
import { SYSTEM_INSTRUCTION } from '../src/shared/translateCore';

describe('SYSTEM_INSTRUCTION (ICU Phase 2)', () => {
  it('teaches the ICU MessageFormat structure', () => {
    expect(SYSTEM_INSTRUCTION).toContain('ICU MessageFormat');
    for (const keyword of ['plural', 'select', 'selectordinal', 'number', 'date', 'time']) {
      expect(SYSTEM_INSTRUCTION).toContain(keyword);
    }
  });

  it('forbids translating keywords, selectors and #', () => {
    for (const token of ['zero', 'one', 'two', 'few', 'many', 'other', 'offset:', '=0', '#']) {
      expect(SYSTEM_INSTRUCTION).toContain(token);
    }
    expect(SYSTEM_INSTRUCTION).toContain('never translate');
  });

  it('requires keeping every clause including other, and never changing format types', () => {
    expect(SYSTEM_INSTRUCTION).toContain('mandatory other clause');
    expect(SYSTEM_INSTRUCTION).toContain('{amount, number} must stay number');
  });

  it('keeps quoted literals untranslated', () => {
    expect(SYSTEM_INSTRUCTION).toContain("quoted literals ('...')");
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
