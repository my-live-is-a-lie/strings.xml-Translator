import { describe, expect, it } from 'vitest';
import { textDirection } from './direction';

describe('textDirection', () => {
  it('detects English text as ltr', () => {
    expect(textDirection('Gemini API')).toBe('ltr');
    expect(textDirection('a')).toBe('ltr');
  });

  it('detects Arabic text as rtl', () => {
    expect(textDirection('مترجم جوجل')).toBe('rtl');
    expect(textDirection('م')).toBe('rtl');
  });

  it('uses the first strong character, not the majority', () => {
    expect(textDirection('Google مترجم')).toBe('ltr');
    expect(textDirection('مترجم Google')).toBe('rtl');
  });

  it('skips neutral characters (digits, spaces, punctuation) until a strong one', () => {
    expect(textDirection('123 Gemini')).toBe('ltr');
    expect(textDirection('-  مترجم')).toBe('rtl');
  });

  it('returns undefined when there is no strong character', () => {
    expect(textDirection('')).toBeUndefined();
    expect(textDirection('123')).toBeUndefined();
    expect(textDirection(' - ')).toBeUndefined();
  });
});
