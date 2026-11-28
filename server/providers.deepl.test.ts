import { afterEach, describe, expect, it, vi } from 'vitest';
import { callProviderWithKey, translateBatch } from './providers';

function stubFetch(translations: string[]) {
  const fn = vi.fn(async () => new Response(JSON.stringify({ translations: translations.map((text) => ({ text })) }), { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const sentBody = (fn: ReturnType<typeof stubFetch>) => JSON.parse(String((fn.mock.calls[0] as unknown[])[1] && ((fn.mock.calls[0] as unknown[])[1] as { body: string }).body));

afterEach(() => vi.unstubAllGlobals());

describe('DeepL request body', () => {
  it('keeps the old three fields when no options are set', async () => {
    const fn = stubFetch(['مرحبا']);
    await callProviderWithKey('deepl', 'k:fx', 'Hello', 'ar');
    expect(sentBody(fn)).toEqual({ text: ['Hello'], source_lang: 'EN', target_lang: 'AR' });
  });

  it('adds the chosen options to a single translation', async () => {
    const fn = stubFetch(['مرحبا']);
    await callProviderWithKey('deepl', 'k:fx', 'Hello', 'ar', undefined, undefined, undefined, undefined, 'en', {
      formality: 'less',
      modelType: 'latency_optimized',
      context: 'Greeting button',
      preserveFormatting: true,
      splitSentences: '0',
    });
    expect(sentBody(fn)).toMatchObject({
      text: ['Hello'],
      target_lang: 'AR',
      formality: 'prefer_less',
      model_type: 'latency_optimized',
      context: 'Greeting button',
      preserve_formatting: true,
      split_sentences: '0',
    });
  });

  it('adds the chosen options to a batch', async () => {
    const fn = stubFetch(['أ', 'ب']);
    await translateBatch('deepl', 'k:fx', ['A', 'B'], 'ar', undefined, 'en', { formality: 'more' });
    expect(sentBody(fn)).toMatchObject({ text: ['A', 'B'], formality: 'prefer_more' });
  });
});

describe('DeepL options from untrusted input', () => {
  it('drops invalid values and sends only the three base fields', async () => {
    const fn = stubFetch(['مرحبا']);
    await callProviderWithKey('deepl', 'k:fx', 'Hello', 'ar', undefined, undefined, undefined, undefined, 'en', {
      formality: 'bogus',
      modelType: 'nope',
      context: '   ',
      preserveFormatting: false,
      splitSentences: '1',
    } as never);
    expect(sentBody(fn)).toEqual({ text: ['Hello'], source_lang: 'EN', target_lang: 'AR' });
  });

  it('keeps the valid options and drops the invalid ones in the same object', async () => {
    const fn = stubFetch(['مرحبا']);
    await callProviderWithKey('deepl', 'k:fx', 'Hello', 'de', undefined, undefined, undefined, undefined, 'en', {
      formality: 'more',
      modelType: 'nope',
    } as never);
    const body = sentBody(fn);
    expect(body.formality).toBe('prefer_more');
    expect(body).not.toHaveProperty('model_type');
  });

  it('cuts a very long context to the shared limit', async () => {
    const fn = stubFetch(['مرحبا']);
    await callProviderWithKey('deepl', 'k:fx', 'Hello', 'ar', undefined, undefined, undefined, undefined, 'en', {
      context: 'x'.repeat(5000),
    });
    expect(sentBody(fn).context).toHaveLength(1000);
  });

  it('ignores an array or a string given as options', async () => {
    const fn = stubFetch(['مرحبا']);
    await callProviderWithKey('deepl', 'k:fx', 'Hello', 'ar', undefined, undefined, undefined, undefined, 'en', [
      { formality: 'more' },
    ] as never);
    expect(sentBody(fn)).toEqual({ text: ['Hello'], source_lang: 'EN', target_lang: 'AR' });
  });

  it('does not put DeepL options in the request of another provider', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Bonjour' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fn);
    await callProviderWithKey('openai', 'sk-x', 'Hello', 'fr', undefined, undefined, undefined, undefined, 'en', {
      formality: 'more',
      context: 'secret note',
    });
    const raw = String(((fn.mock.calls[0] as unknown[])[1] as { body: string }).body);
    expect(raw).not.toContain('secret note');
    expect(raw).not.toContain('formality');
  });
});
