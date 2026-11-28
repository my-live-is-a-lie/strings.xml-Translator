import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSafeLibreBase, directCallProviderWithKey } from './directProviders';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

// Request bodies differ per provider; the tests read them loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

function stubFetch(handler: (url: string, body: Body) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) =>
    handler(String(url), init?.body ? JSON.parse(String(init.body)) : undefined)
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}
const call = (i: number, fn: ReturnType<typeof stubFetch>) => {
  const [url, init] = fn.mock.calls[i] as unknown as [string, RequestInit];
  return { url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : undefined };
};

beforeEach(() => vi.stubGlobal('window', {}));
afterEach(() => vi.unstubAllGlobals());

describe('assertSafeLibreBase', () => {
  it('keeps the origin and path and drops a trailing slash', () => {
    expect(assertSafeLibreBase('https://libre.example.com/')).toBe('https://libre.example.com');
    expect(assertSafeLibreBase('https://libre.example.com/api/')).toBe('https://libre.example.com/api');
  });
  it.each([
    ['http scheme', 'http://libre.example.com'],
    ['credentials', 'https://user:pw@libre.example.com'],
    ['ipv4', 'https://192.168.1.5'],
    ['ipv6', 'https://[::1]'],
    ['localhost', 'https://localhost'],
    ['.local name', 'https://printer.local'],
    ['.internal name', 'https://svc.internal'],
    ['single-label host', 'https://intranet'],
    ['not a url', 'not a url'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertSafeLibreBase(url)).toThrow();
  });
});

describe('directCallProviderWithKey: DeepL', () => {
  const ok = () => json(200, { translations: [{ text: 'مرحبا' }] });

  it('uses the free host for :fx keys and the paid host otherwise', async () => {
    const fn = stubFetch(ok);
    await directCallProviderWithKey('deepl', 'k:fx', 'Hello', 'ar');
    await directCallProviderWithKey('deepl', 'k-paid', 'Hello', 'ar');
    expect(call(0, fn).url).toBe('https://api-free.deepl.com/v2/translate');
    expect(call(1, fn).url).toBe('https://api.deepl.com/v2/translate');
  });

  it('maps pt-rBR and zh-rCN to the codes DeepL expects', async () => {
    const fn = stubFetch(ok);
    await directCallProviderWithKey('deepl', 'k:fx', 'Hello', 'pt-rBR');
    await directCallProviderWithKey('deepl', 'k:fx', 'Hello', 'zh-rCN');
    await directCallProviderWithKey('deepl', 'k:fx', 'Hello', 'fr');
    expect(call(0, fn).body.target_lang).toBe('PT-BR');
    expect(call(1, fn).body.target_lang).toBe('ZH-HANS');
    expect(call(2, fn).body.target_lang).toBe('FR');
  });

  it('sends the chosen source language', async () => {
    const fn = stubFetch(ok);
    await directCallProviderWithKey('deepl', 'k:fx', 'Bonjour', 'ar', undefined, undefined, undefined, undefined, 'fr');
    expect(call(0, fn).body.source_lang).toBe('FR');
  });

  it('sends only valid options and never an unset one', async () => {
    const fn = stubFetch(ok);
    await directCallProviderWithKey('deepl', 'k:fx', 'Hello', 'ar', undefined, undefined, undefined, undefined, 'en', {
      formality: 'bogus',
      modelType: 'nope',
      context: '   ',
      preserveFormatting: false,
      splitSentences: '1',
    } as never);
    expect(call(0, fn).body).toEqual({ text: ['Hello'], source_lang: 'EN', target_lang: 'AR' });
  });

  it('turns an HTTP error into an error naming DeepL', async () => {
    stubFetch(() => json(403, {}));
    await expect(directCallProviderWithKey('deepl', 'k:fx', 'Hello', 'ar')).rejects.toThrow(/DeepL/);
  });

  it('fails on an empty translation list', async () => {
    stubFetch(() => json(200, { translations: [] }));
    await expect(directCallProviderWithKey('deepl', 'k:fx', 'Hello', 'ar')).rejects.toThrow(/DeepL/);
  });

  it('reports the provider type that answered', async () => {
    stubFetch(ok);
    const r = await directCallProviderWithKey('deepl', 'k:fx', 'Hello', 'ar');
    expect(r).toEqual({ translatedText: 'مرحبا', detectedType: 'deepl' });
  });
});

describe('directCallProviderWithKey: OpenAI', () => {
  const reply = (content: string) => () => json(200, { choices: [{ message: { content } }] });

  it('names the source and target language and the plural form in the prompt', async () => {
    const fn = stubFetch(reply('x'));
    await directCallProviderWithKey('openai', 'sk-1', 'Hello', 'ar', 'Arabic', 'few', undefined, undefined, 'fr');
    const prompt: string = call(0, fn).body.messages[1].content;
    expect(prompt).toContain('from French');
    expect(prompt).toContain('Arabic (ar)');
    expect(prompt).toContain('CLDR plural form: few');
    expect(call(0, fn).init.headers).toMatchObject({ Authorization: 'Bearer sk-1' });
  });

  it('trims the key before using it', async () => {
    const fn = stubFetch(reply('x'));
    await directCallProviderWithKey('openai', '  sk-1  ', 'Hello', 'ar');
    expect(call(0, fn).init.headers).toMatchObject({ Authorization: 'Bearer sk-1' });
  });

  it('rejects a reply that breaks the placeholders', async () => {
    stubFetch(reply('مرحبا'));
    await expect(directCallProviderWithKey('openai', 'sk-1', 'Hello %1$s', 'ar')).rejects.toMatchObject({
      name: 'StructuralError',
    });
  });

  it('fails on an empty reply and on an HTTP error', async () => {
    stubFetch(() => json(200, { choices: [] }));
    await expect(directCallProviderWithKey('openai', 'sk-1', 'Hello', 'ar')).rejects.toThrow(/OpenAI/);
    stubFetch(() => json(401, {}));
    await expect(directCallProviderWithKey('openai', 'sk-1', 'Hello', 'ar')).rejects.toThrow(/OpenAI/);
  });
});

describe('directCallProviderWithKey: Google Cloud, Microsoft, Yandex, LibreTranslate', () => {
  it('Google Cloud sends the key in a header, not the URL, with base target code', async () => {
    const fn = stubFetch(() => json(200, { data: { translations: [{ translatedText: 'bonjour' }] } }));
    await directCallProviderWithKey('google_cloud', 'gkey', 'Hello', 'pt-rBR', undefined, undefined, undefined, undefined, 'de');
    const c = call(0, fn);
    expect(c.url).not.toContain('gkey');
    expect(c.init.headers).toMatchObject({ 'X-goog-api-key': 'gkey' });
    expect(c.body).toMatchObject({ q: 'Hello', source: 'de', target: 'pt' });
  });

  it('Microsoft puts from/to in the URL and the text in the body', async () => {
    const fn = stubFetch(() => json(200, [{ translations: [{ text: 'hola' }] }]));
    await directCallProviderWithKey('microsoft', 'mkey', 'Hello', 'es', undefined, undefined, undefined, undefined, 'fr');
    const c = call(0, fn);
    expect(c.url).toContain('from=fr');
    expect(c.url).toContain('to=es');
    expect(c.body).toEqual([{ Text: 'Hello' }]);
  });

  it('Yandex uses an Api-Key header, or Bearer for t1. tokens, and sends the folder id', async () => {
    const fn = stubFetch(() => json(200, { translations: [{ text: 'привет' }] }));
    await directCallProviderWithKey('yandex', 'AQVNkey', 'Hello', 'ru', undefined, undefined, 'folder1');
    await directCallProviderWithKey('yandex', 't1.token', 'Hello', 'ru');
    expect(call(0, fn).init.headers).toMatchObject({ Authorization: 'Api-Key AQVNkey' });
    expect(call(0, fn).body).toMatchObject({ folderId: 'folder1', targetLanguageCode: 'ru', texts: ['Hello'] });
    expect(call(1, fn).init.headers).toMatchObject({ Authorization: 'Bearer t1.token' });
    expect(call(1, fn).body.folderId).toBeUndefined();
  });

  it('Yandex falls back to YandexGPT when the translate call fails, naming the source language', async () => {
    const fn = stubFetch((url) =>
      url.includes('translate/v2')
        ? json(403, {})
        : json(200, { result: { alternatives: [{ message: { text: 'привет' } }] } })
    );
    const r = await directCallProviderWithKey('yandex', 'AQVNkey', 'Hello', 'ru', undefined, undefined, 'f1', undefined, 'fr');
    expect(r.translatedText).toBe('привет');
    expect(call(1, fn).url).toContain('llm.api.cloud.yandex.net');
    expect(call(1, fn).body.modelUri).toBe('gpt://f1/yandexgpt-lite/latest');
    expect(call(1, fn).body.messages[1].text).toContain('from French');
  });

  it('Yandex fails when both calls fail', async () => {
    stubFetch(() => json(403, {}));
    await expect(directCallProviderWithKey('yandex', 'AQVNkey', 'Hello', 'ru')).rejects.toThrow(/Yandex/);
  });

  it('LibreTranslate defaults to the public host and leaves out a missing or "none" key', async () => {
    const fn = stubFetch(() => json(200, { translatedText: 'hallo' }));
    await directCallProviderWithKey('libretranslate', 'none', 'Hello', 'de');
    await directCallProviderWithKey('libretranslate', '', 'Hello', 'de');
    await directCallProviderWithKey('libretranslate', 'abc', 'Hello', 'de', undefined, undefined, 'libre.example.com/');
    expect(call(0, fn).url).toBe('https://libretranslate.com/translate');
    expect(call(0, fn).body.api_key).toBeUndefined();
    expect(call(1, fn).body.api_key).toBeUndefined();
    expect(call(2, fn).url).toBe('https://libre.example.com/translate');
    expect(call(2, fn).body.api_key).toBe('abc');
  });

  it('LibreTranslate refuses a private server before any request is made', async () => {
    const fn = stubFetch(() => json(200, { translatedText: 'x' }));
    await expect(
      directCallProviderWithKey('libretranslate', '', 'Hello', 'de', undefined, undefined, 'http://192.168.0.2:5000')
    ).rejects.toThrow(/LibreTranslate/);
    await expect(
      directCallProviderWithKey('libretranslate', '', 'Hello', 'de', undefined, undefined, 'localhost')
    ).rejects.toThrow(/LibreTranslate/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('directCallProviderWithKey: auto-detect', () => {
  const firstUrl = async (key: string) => {
    const fn = stubFetch(() => json(500, {}));
    await directCallProviderWithKey('auto', key, 'Hello', 'ar').catch(() => undefined);
    return call(0, fn).url;
  };

  it('tries the provider that matches the key shape first', async () => {
    expect(await firstUrl('sk-abc')).toContain('api.openai.com');
    expect(await firstUrl('abc:fx')).toContain('api-free.deepl.com');
    expect(await firstUrl('AQVNxyz')).toContain('translate.api.cloud.yandex.net');
    expect(await firstUrl('trnsl.1.1.abc')).toContain('translate.api.cloud.yandex.net');
  });

  it('returns the first provider that answers and reports its type', async () => {
    stubFetch((url) =>
      url.includes('openai') ? json(200, { choices: [{ message: { content: 'مرحبا' } }] }) : json(500, {})
    );
    const r = await directCallProviderWithKey('auto', 'sk-abc', 'Hello', 'ar');
    expect(r).toEqual({ translatedText: 'مرحبا', detectedType: 'openai' });
  });

  it('never tries LibreTranslate on its own', async () => {
    const fn = stubFetch(() => json(500, {}));
    await directCallProviderWithKey('auto', 'plainkey', 'Hello', 'ar').catch(() => undefined);
    expect(fn.mock.calls.map((c) => String(c[0])).some((u) => u.includes('libretranslate.com'))).toBe(false);
  });

  it('throws one clear error when no provider accepts the key', async () => {
    stubFetch(() => json(500, {}));
    await expect(directCallProviderWithKey('auto', 'sk-abc', 'Hello', 'ar')).rejects.toThrow(/could not be verified/);
  });

  it('treats an unknown provider type like auto', async () => {
    stubFetch((url) =>
      url.includes('openai') ? json(200, { choices: [{ message: { content: 'ok' } }] }) : json(500, {})
    );
    const r = await directCallProviderWithKey('something-else', 'sk-abc', 'Hello', 'ar');
    expect(r.detectedType).toBe('openai');
  });
});
