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
