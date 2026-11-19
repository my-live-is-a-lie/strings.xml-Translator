// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkTranslateItems,
  clearTranslationCache,
  isFillableSuggestion,
  isRetryableError,
  suggestTranslation,
  suggestionRejectedForIcu,
} from '../src/utils/translator';
import type { ArrayStringItem, PluralStringItem, ResourceItem, SingleStringItem } from '../src/types';
import { hasMultilineIcuBlock, validatePlaceholders } from '../src/utils/placeholderCheck';

/**
 * End-to-end ICU behaviour of the translation pipeline.
 *
 * The earlier tests checked each provider in isolation. These drive `suggestTranslation`,
 * which is what the editor actually calls, so they cover the path where a provider's reply
 * is rewritten by `restoreSegmentSyntax` before it reaches the user. Two bugs lived exactly
 * there: `select` clause text was re-inserted in English because `{He}` looks like `{name}`,
 * and a machine-translation reply that broke the block structure was accepted as-is.
 */

const gtxOk = (text: string) =>
  new Response(JSON.stringify([[[text, 'src', null, null, 1]], null, 'en']), { status: 200 });
const gtxErr = (status: number) => new Response('{}', { status });
const myMemoryOk = (text: string) =>
  new Response(JSON.stringify({ responseData: { translatedText: text }, matches: [] }), { status: 200 });

/** Answers Google GTX with `text` and MyMemory with `fallback`. */
const replyWith = (text: string, fallback = text) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('translate.googleapis.com') ? gtxOk(text) : myMemoryOk(fallback)
    )
  );

beforeEach(() => {
  clearTranslationCache();
  vi.unstubAllGlobals();
});

describe('ICU blocks survive the machine-translation path', () => {
  const PLURAL = 'You have {count, plural, one {# message} other {# messages}}';

  it('keeps a well-formed plural translation intact', async () => {
    replyWith('لديك {count, plural, one {# رسالة} other {# رسائل}}');
    const res = await suggestTranslation(PLURAL, 'ar');
    expect(res.text).toBe('لديك {count, plural, one {# رسالة} other {# رسائل}}');
    expect(res.source).toBe('google');
    expect(validatePlaceholders(PLURAL, res.text, 'ar').valid).toBe(true);
  });

  it('rejects a reply that dropped the other clause instead of returning it', async () => {
    replyWith('لديك {count, plural, one {# رسالة}}');
    const res = await suggestTranslation(PLURAL, 'ar');
    // Nothing usable came back, so the segment falls through to the offline heuristic
    // (the source text) rather than reaching the user as a block that throws at runtime.
    expect(res.source).toBe('heuristic');
    expect(res.text).toBe(PLURAL);
  });

  it('rejects a reply whose braces were rewritten by the engine', async () => {
    replyWith('لديك {count, plural, one {# رسالة} other {# رسائل}');
    const res = await suggestTranslation(PLURAL, 'ar');
    expect(res.source).toBe('heuristic');
  });

  it('does not check strings without braces (no cost on the common path)', async () => {
    replyWith('مرحبا بالعالم');
    const res = await suggestTranslation('Hello world', 'ar');
    expect(res.text).toBe('مرحبا بالعالم');
    expect(res.source).toBe('google');
  });
});

describe('select clause text is translatable, not a token to restore', () => {
  const SELECT = '{gender, select, male {He} female {She} other {They}} liked your post';

  it('does not append the English clause text after a correct translation', async () => {
    // `{He}` is indistinguishable from `{name}` by its text alone, so this used to come
    // back as `... منشورك {He} {She} {They}` — valid ICU, but with English garbage inside.
    replyWith('{gender, select, male {أعجبه} female {أعجبتها} other {أعجبهم}} منشورك');
    const res = await suggestTranslation(SELECT, 'ar');
    expect(res.text).toBe('{gender, select, male {أعجبه} female {أعجبتها} other {أعجبهم}} منشورك');
    expect(res.text).not.toContain('{He}');
    expect(validatePlaceholders(SELECT, res.text, 'ar').valid).toBe(true);
  });

  it('still restores a plain placeholder inside a select clause', async () => {
    const source = '{gender, select, male {He has %1$d} other {They have %1$d}}';
    replyWith('{gender, select, male {لديه %1$d} other {لديهم %1$d}}');
    const res = await suggestTranslation(source, 'ar');
    expect(res.text).toContain('%1$d');
    expect(validatePlaceholders(source, res.text, 'ar').valid).toBe(true);
  });

  it('keeps an offset: selector untouched', async () => {
    const source = '{count, plural, offset:1 =0 {Nobody} one {# friend} other {# friends}}';
    replyWith('{count, plural, offset:1 =0 {لا أحد} one {# صديق} other {# أصدقاء}}');
    const res = await suggestTranslation(source, 'ar');
    expect(res.text).toContain('offset:1');
    expect(res.text).toContain('=0');
    expect(validatePlaceholders(source, res.text, 'ar').valid).toBe(true);
  });
});

describe('a structurally damaged reply is not retried', () => {
  it('is treated as a permanent failure', () => {
    // A plain error without a retryable status is not retried, and the structural
    // rejection must behave the same way (it used to fall through to `false` only by luck).
    expect(isRetryableError(new Error('Gemini: damaged ICU'))).toBe(false);
    const structural = new Error('OpenAI: الردّ يخالف بنية ICU');
    structural.name = 'StructuralError';
    expect(isRetryableError(structural)).toBe(false);
  });

  it('does not burn a retry cycle on a bad Gemini structure reply', async () => {
    let geminiCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (!String(url).includes('generativelanguage')) return gtxErr(500);
        geminiCalls++;
        // Every model keeps dropping the `other` clause.
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: '{count, plural, one {# رسالة}}' }] } }] }),
          { status: 200 }
        );
      })
    );
    const { geminiTranslateDirect } = await import('../src/utils/geminiDirect');
    await expect(
      geminiTranslateDirect({
        apiKey: 'k',
        sourceText: '{count, plural, one {# message} other {# messages}}',
        targetLang: 'ar',
      })
    ).rejects.toThrow(/ICU/);
    // With the old behaviour each model was tried up to 3 times (withRetry).
    expect(geminiCalls).toBeLessThanOrEqual(4);
  });
});

describe('quoted printf tokens keep their re-insertion guarantee', () => {
  it('re-inserts a dropped quoted printf specifier instead of losing it', async () => {
    // `reinsertedTokenWouldDuplicate` must not mistake a quoted "%1$s" for clause text:
    // it starts with a quote, not with %, so the shape checks above miss it. The old
    // guarantee re-inserted it; losing it would silently drop the specifier.
    replyWith('اضغط للمتابعة');
    const res = await suggestTranslation('Press \\"%1$s\\" to continue', 'ar');
    expect(res.text).toContain('%1$s');
  });
});

describe('ICU blocks that span a line break', () => {
  const MULTILINE = 'Intro {count, plural,\n one {# message} other {# messages}}';

  it('are detected, while plain multiline text and single-line blocks are not', () => {
    expect(hasMultilineIcuBlock(MULTILINE)).toBe(true);
    expect(hasMultilineIcuBlock('Intro {count, plural, one {# m} other {# ms}}')).toBe(false);
    expect(hasMultilineIcuBlock('line one\nline two')).toBe(false);
  });

  it('are translated as one piece, so the check sees the whole block', async () => {
    // Splitting on the line break would leave every piece unbalanced, and an unbalanced
    // source disables the structural check — a dropped clause would pass unnoticed.
    replyWith('مقدمة {count, plural,\n one {# رسالة} other {# رسائل}}');
    const res = await suggestTranslation(MULTILINE, 'ar');
    expect(res.text).toBe('مقدمة {count, plural,\n one {# رسالة} other {# رسائل}}');
    expect(validatePlaceholders(MULTILINE, res.text, 'ar').valid).toBe(true);
  });

  it('are rejected when the reply drops a clause', async () => {
    replyWith('مقدمة {count, plural,\n one {# رسالة}}');
    const res = await suggestTranslation(MULTILINE, 'ar');
    expect(res.source).toBe('heuristic');
    expect(res.text).toBe(MULTILINE);
  });

  it('plain multiline text still splits and translates piece by piece', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const q = new URL(String(url)).searchParams.get('q') ?? '';
        const ar = q.includes('one') ? 'سطر أول' : 'سطر ثان';
        return gtxOk(ar);
      })
    );
    const res = await suggestTranslation('Line one\nLine two', 'ar');
    expect(res.text).toBe('سطر أول\nسطر ثان');
  });
});

describe('a rejected suggestion is reported honestly', () => {
  const PLURAL = '{count, plural, one {# message} other {# messages}}';

  it('flags only the rejection, not a successful suggestion', async () => {
    replyWith('{count, plural, one {# رسالة} other {# رسائل}}');
    await suggestTranslation(PLURAL, 'ar');
    expect(suggestionRejectedForIcu()).toBe(false);

    clearTranslationCache();
    replyWith('{count, plural, one {# رسالة}}');
    await suggestTranslation(PLURAL, 'ar');
    expect(suggestionRejectedForIcu()).toBe(true);
  });

  it('leaves a rejected string untranslated instead of marking it "Heuristic"', async () => {
    // The engines answer the source unchanged when nothing usable came back; calling that a
    // translation marked a broken string as done and hid it from the "Untranslated" filter.
    replyWith('{count, plural, one {# رسالة}}');
    const item: ResourceItem = {
      id: 'a',
      name: 'a',
      type: 'string',
      order: 0,
      status: 'untranslated',
      source: PLURAL,
      target: '',
    } as SingleStringItem;
    const [out] = (await bulkTranslateItems([item], 'ar')) as SingleStringItem[];
    expect(out.status).toBe('untranslated');
    expect(out.translationEngine).toBeUndefined();
    // Not the English source: leaving it empty keeps it in the editor's "Untranslated" filter
    // instead of putting English text into a file that is supposed to be Arabic.
    expect(out.target).toBe('');
    expect(out.target).not.toBe(PLURAL);
  });

  it('keeps an existing target when the engines are rejected, and never the English source', async () => {
    replyWith('{count, plural, one {# رسالة}}');
    const item: ResourceItem = {
      id: 'b',
      name: 'b',
      type: 'string',
      order: 0,
      status: 'translated',
      source: PLURAL,
      target: 'ترجمة سابقة للمستخدم',
      translationSource: 'ai',
      translationEngine: 'google',
    } as SingleStringItem;
    const [out] = (await bulkTranslateItems([item], 'ar')) as SingleStringItem[];
    expect(out.target).toBe('ترجمة سابقة للمستخدم');
    expect(out.status).toBe('translated'); // the user's own text is preserved and still counts
    // The kept text is the user's own: its previous engine stays, 'heuristic' is never
    // recorded as the engine of text no engine produced.
    expect(out.translationEngine).toBe('google');
    expect(out.translationSource).toBe('ai');
  });

  it('keeps the previous target in bulk plurals and arrays instead of the English source', async () => {
    replyWith('{count, plural, one {# رسالة}}');
    const plural: ResourceItem = {
      id: 'p',
      name: 'p',
      type: 'plural',
      order: 0,
      status: 'untranslated',
      items: [{ quantity: 'one', source: PLURAL, target: '' }],
    } as unknown as PluralStringItem;
    const [pOut] = (await bulkTranslateItems([plural], 'ar')) as PluralStringItem[];
    expect(pOut.items[0].target).toBe('');
    expect(pOut.items[0].target).not.toBe(PLURAL);
    const arr: ResourceItem = {
      id: 'arr',
      name: 'arr',
      type: 'array',
      order: 0,
      status: 'untranslated',
      items: [{ source: PLURAL, target: '' }],
    } as unknown as ArrayStringItem;
    const [aOut] = (await bulkTranslateItems([arr], 'ar')) as ArrayStringItem[];
    expect(aOut.items[0].target).toBe('');
    expect(aOut.items[0].target).not.toBe(PLURAL);
  });

  it('a cached success clears a stale rejection flag', async () => {
    // The flag is reset once per suggestion, not per segment: a cache hit never reaches
    // the uncached path, so resetting there left the flag true after a good suggestion.
    replyWith('مرحبا');
    await suggestTranslation('Hello', 'ar');
    expect(suggestionRejectedForIcu()).toBe(false);

    replyWith('{count, plural, one {# رسالة}}');
    await suggestTranslation(PLURAL, 'ar');
    expect(suggestionRejectedForIcu()).toBe(true);

    const again = await suggestTranslation('Hello', 'ar');
    expect(again.source).toBe('google'); // cache hit
    expect(suggestionRejectedForIcu()).toBe(false);
  });

  it('a plural translated by the offline glossary still counts as translated', async () => {
    // 'Cancel' is in the Android UI glossary; excluding 'glossary' marked a fully
    // translated plural as untranslated.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const plural: ResourceItem = {
      id: 'p',
      name: 'p',
      type: 'plural',
      order: 0,
      status: 'untranslated',
      items: [
        { quantity: 'one', source: 'Cancel', target: '' },
        { quantity: 'other', source: 'Cancel', target: '' },
      ],
    } as unknown as PluralStringItem;
    const [out] = (await bulkTranslateItems([plural], 'ar')) as PluralStringItem[];
    expect(out.items[0].target).toBe('إلغاء');
    expect(out.status).toBe('translated');
    expect(out.translationEngine).toBe('glossary');
  });

  it('a rejected array element stays untranslated, like strings and plurals', async () => {
    replyWith('{count, plural, one {# رسالة}}');
    const arr: ResourceItem = {
      id: 'arr',
      name: 'arr',
      type: 'array',
      order: 0,
      status: 'untranslated',
      items: [{ source: PLURAL, target: '' }],
    } as unknown as ArrayStringItem;
    const [out] = (await bulkTranslateItems([arr], 'ar')) as ArrayStringItem[];
    expect(out.status).toBe('untranslated');
    expect(out.translationEngine).toBeUndefined();
  });

  it('a later engine succeeding in the same call clears the rejection flag', async () => {
    // Google breaks the block (flag set), MyMemory answers it whole: the suggestion is
    // good, so no alert may appear next to it. Before the fix the flag only ever went
    // true, and the editor warned about a suggestion that was actually fine.
    replyWith(
      '{count, plural, one {# رسالة}}',
      '{count, plural, one {# رسالة} other {# رسائل}}'
    );
    const res = await suggestTranslation(PLURAL, 'ar');
    expect(res.source).toBe('mymemory');
    expect(res.text).toBe('{count, plural, one {# رسالة} other {# رسائل}}');
    expect(suggestionRejectedForIcu()).toBe(false);
  });

  it('isFillableSuggestion only accepts a real translation', () => {
    expect(isFillableSuggestion({ text: 'مرحبا', source: 'google' })).toBe(true);
    expect(isFillableSuggestion({ text: 'إلغاء', source: 'glossary' })).toBe(true);
    expect(isFillableSuggestion({ text: 'Hello', source: 'heuristic' })).toBe(false);
    expect(isFillableSuggestion({ text: '', source: 'google' })).toBe(false);
    expect(isFillableSuggestion(undefined)).toBe(false);
    expect(isFillableSuggestion(null)).toBe(false);
  });
});
