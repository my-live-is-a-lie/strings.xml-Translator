// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTranslationCache, normalizeEngineReply, suggestTranslation } from '../src/utils/translator';
import { countLineBreaks } from '../src/utils/newlines';

const NB = '\u00a0';

describe('normalizeEngineReply: outer whitespace and BOM', () => {
  it('drops outer whitespace and an interior BOM', () => {
    expect(normalizeEngineReply('Hello world', `\ufeff \n مرحبا \ufeffبالعالم\n`)).toBe('مرحبا بالعالم');
  });
});

describe('normalizeEngineReply: a break an engine adds to a single-line source', () => {
  it('turns real and escaped breaks into one space', () => {
    for (const reply of ['مرحبا\nبالعالم', 'مرحبا\r\nبالعالم', 'مرحبا \\n بالعالم']) {
      expect(normalizeEngineReply('Hello world', reply)).toBe('مرحبا بالعالم');
    }
  });

  it('leaves an escaped backslash followed by n alone (it is not a line break)', () => {
    expect(normalizeEngineReply('Path', 'C:\\\\new')).toBe('C:\\\\new');
  });

  it('keeps the escaped backslashes in front of a real escaped break', () => {
    // three backslashes + n = an escaped backslash, then the `\n` break
    expect(normalizeEngineReply('Path', 'a\\\\\\nb')).toBe('a\\\\ b');
  });

  it('does not touch the breaks of a multiline source', () => {
    expect(normalizeEngineReply('a\nb', 'x\ny')).toBe('x\ny');
  });
});

describe('normalizeEngineReply: a no-break space the engine dropped', () => {
  it('restores it when no anchored word moved', () => {
    expect(normalizeEngineReply(`Hello${NB}world`, 'مرحبا بالعالم')).toBe(`مرحبا${NB}بالعالم`);
    expect(normalizeEngineReply(`10${NB}MB free`, '10 ميغابايت متاح')).toBe(`10${NB}ميغابايت متاح`);
    expect(normalizeEngineReply(`10${NB}MB free`, '١٠ ميغابايت متاح')).toBe(`١٠${NB}ميغابايت متاح`);
  });

  it('keeps the reply when the number moved (word order changed)', () => {
    expect(normalizeEngineReply(`10${NB}MB free`, 'متاح 10 ميغابايت')).toBe('متاح 10 ميغابايت');
  });

  it('keeps the reply when the word count differs', () => {
    expect(normalizeEngineReply(`a${NB}b c`, 'x y')).toBe('x y');
  });
});

describe('a reply that loses the line breaks of a multiline ICU string is not returned', () => {
  beforeEach(() => {
    clearTranslationCache();
    vi.unstubAllGlobals();
  });

  it('falls back to the per-clause path, which keeps every break', async () => {
    const src = 'You have {count, plural,\n  one {# m}\n  other {# ms}\n}';
    // Valid ICU, but written on one line: the whole-string reply used to be accepted
    // and then refused by the line-break save gate.
    const oneLine = 'لديك {count, plural, one {# د} other {# دد}}';
    const dict: Record<string, string> = { [src]: oneLine, 'You have': 'لديك', '# m': '# د', '# ms': '# دد' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const q = new URL(String(url)).searchParams.get('q') ?? '';
        const text = dict[q] ?? '';
        if (String(url).includes('translate.googleapis.com')) {
          return new Response(JSON.stringify([[[text, q, null, null, 1]], null, 'en']), { status: 200 });
        }
        return new Response(JSON.stringify({ responseData: { translatedText: text }, matches: [] }), { status: 200 });
      })
    );
    const res = await suggestTranslation(src, 'ar');
    expect(res.text).not.toBe(oneLine);
    expect(countLineBreaks(res.text)).toBe(countLineBreaks(src));
  });
});
