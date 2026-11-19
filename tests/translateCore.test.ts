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

  it('allows adapting plural categories to the target language, but protects other, offset and select keys', () => {
    expect(SYSTEM_INSTRUCTION).toContain('adapt the categories to the target language');
    expect(SYSTEM_INSTRUCTION).toContain('Arabic needs zero, one, two, few, many, other');
    expect(SYSTEM_INSTRUCTION).toContain('Japanese needs only other');
    expect(SYSTEM_INSTRUCTION).toContain('never remove other');
    expect(SYSTEM_INSTRUCTION).toContain('never change the offset: value');
    expect(SYSTEM_INSTRUCTION).toContain('never add, remove or change select keys');
  });

  it('translates human words inside quoted literals but keeps the quotes and syntax', () => {
    expect(SYSTEM_INSTRUCTION).toContain("Quoted literals ('...')");
    expect(SYSTEM_INSTRUCTION).toContain('translate the human-readable words');
    expect(SYSTEM_INSTRUCTION).toContain("''Hello!''");
    expect(SYSTEM_INSTRUCTION).toContain("'{username}'");
    expect(SYSTEM_INSTRUCTION).toContain('shows a placeholder literally');
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
