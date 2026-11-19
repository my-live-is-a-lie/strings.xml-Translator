import { afterEach, describe, expect, it, vi } from 'vitest';
import { callProviderWithKey } from '../server/providers';

// The AI providers (OpenAI, YandexGPT) now run every reply through the same ICU structure
// check the QA path uses. A reply that drops a brace, a clause or the `#` would throw at
// runtime (`String.format`), so it must be rejected instead of returned as a translation.
const PLURAL = '{count, plural, one {# message} other {# messages}}';
const PLURAL_OK = '{count, plural, one {# رسالة} other {# رسائل}}';
const PLURAL_BROKEN = '{count, plural, one {# رسالة}}';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

const openAiReply = (text: string) => json({ choices: [{ message: { content: text } }] });
const yandexGptReply = (text: string) => json({ result: { alternatives: [{ message: { text } }] } });

describe('server providers keep the ICU structure intact', () => {
  it('returns an OpenAI reply that preserves the structure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => openAiReply(PLURAL_OK)));
    const res = await callProviderWithKey('openai', 'k', PLURAL, 'ar');
    expect(res.translatedText).toBe(PLURAL_OK);
  });

  it('rejects an OpenAI reply that drops the other clause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => openAiReply(PLURAL_BROKEN)));
    await expect(callProviderWithKey('openai', 'k', PLURAL, 'ar')).rejects.toThrow(/ICU/);
  });

  it('returns a YandexGPT reply that preserves the structure', async () => {
    // Yandex tries Cloud Translate first; make it answer without text so the YandexGPT
    // fallback (the AI path that carries the instruction) is the one under test.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/translate/v2/translate') ? json({ translations: [] }) : yandexGptReply(PLURAL_OK)
      )
    );
    const res = await callProviderWithKey('yandex', 'k', PLURAL, 'ar');
    expect(res.translatedText).toBe(PLURAL_OK);
  });

  it('rejects a YandexGPT reply that drops the other clause', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/translate/v2/translate')
          ? json({ translations: [] })
          : yandexGptReply(PLURAL_BROKEN)
      )
    );
    await expect(callProviderWithKey('yandex', 'k', PLURAL, 'ar')).rejects.toThrow(/ICU/);
  });

  it('leaves a non-ICU string untouched by the guard', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => openAiReply('حفظ')));
    const res = await callProviderWithKey('openai', 'k', 'Save', 'ar');
    expect(res.translatedText).toBe('حفظ');
  });
});
