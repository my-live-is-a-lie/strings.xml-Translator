import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiTranslateDirect, geminiThinkingConfig, isModelUnavailableMessage, looksLikeGeminiKey } from '../src/utils/geminiDirect';

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const err = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status });

afterEach(() => vi.unstubAllGlobals());

describe('gemini model fallback', () => {
  it('recognises a retired model but not a bad key', () => {
    expect(isModelUnavailableMessage(404, 'models/x is not found')).toBe(true);
    expect(isModelUnavailableMessage(400, 'This model is no longer available to new users')).toBe(true);
    expect(isModelUnavailableMessage(403, 'API key not valid')).toBe(false);
    expect(isModelUnavailableMessage(429, 'quota')).toBe(false);
  });

  it('moves to the next model when one is retired', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return urls.length === 1 ? err(404, 'This model is no longer available to new users') : ok('مرحبا');
      })
    );
    expect(await geminiTranslateDirect({ apiKey: 'k', sourceText: 'Hello' })).toBe('مرحبا');
    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toBe(urls[1]);
  });

  it('does not hide a bad key behind the fallback', async () => {
    const fetchMock = vi.fn(async () => err(400, 'API key not valid. Please pass a valid API key.'));
    vi.stubGlobal('fetch', fetchMock);
    // Google's 400 is classified: the rejection names the key problem, not the raw API wording.
    await expect(geminiTranslateDirect({ apiKey: 'bad', sourceText: 'Hello' })).rejects.toThrow(
      /invalid or disabled/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the ICU rules in the system instruction and the prompt', async () => {
    let body = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        body = String(init?.body ?? '');
        return ok('مرحبا');
      })
    );
    expect(await geminiTranslateDirect({ apiKey: 'k', sourceText: 'Hello' })).toBe('مرحبا');
    const parsed = JSON.parse(body) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    const system = parsed.systemInstruction.parts[0].text;
    expect(system).toContain('ICU MessageFormat');
    expect(system).toContain('{count, plural, one {# message} other {# messages}}');
    const userPrompt = parsed.contents[0].parts[0].text;
    expect(userPrompt).toContain('ICU MessageFormat block');
    expect(userPrompt).toContain('protect only its syntax');
    expect(userPrompt).toContain('translate the human-readable text inside each clause');
  });

  it('does not describe the plural quantity as a CLDR category (upstream sends one form, not a category)', async () => {
    let body = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        body = String(init?.body ?? '');
        return ok('مرحبا');
      })
    );
    await geminiTranslateDirect({ apiKey: 'k', sourceText: 'Hello', pluralQuantity: 'one' });
    const userPrompt = (JSON.parse(body) as { contents: Array<{ parts: Array<{ text: string }> }> })
      .contents[0].parts[0].text;
    expect(userPrompt).toContain('"one" CLDR plural form');
    expect(userPrompt).not.toContain('Plural quantity category');
  });

  it('rejects a reply that damages the ICU structure and tries the next model', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        // First model drops the `other` clause; the second answers correctly.
        return urls.length === 1
          ? ok('{count, plural, one {# رسالة}}')
          : ok('{count, plural, one {# رسالة} other {# رسائل}}');
      })
    );
    const source = '{count, plural, one {# message} other {# messages}}';
    expect(await geminiTranslateDirect({ apiKey: 'k', sourceText: source, targetLang: 'ar' })).toBe(
      '{count, plural, one {# رسالة} other {# رسائل}}'
    );
    expect(urls).toHaveLength(2);
  });

  it('accepts a structurally sound ICU reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok('{count, plural, one {# رسالة} other {# رسائل}}')));
    const source = '{count, plural, one {# message} other {# messages}}';
    expect(await geminiTranslateDirect({ apiKey: 'k', sourceText: source, targetLang: 'ar' })).toBe(
      '{count, plural, one {# رسالة} other {# رسائل}}'
    );
  });
});

describe('looksLikeGeminiKey', () => {
  it('recognises AI Studio Gemini key shapes', () => {
    // Synthetic placeholder: deliberately not a valid key, keeps secret scanners quiet.
    expect(looksLikeGeminiKey('AIzaTEST-ONLY-not-a-real-key')).toBe(true);
    expect(looksLikeGeminiKey('AQ.AbCdEfGh123')).toBe(true);
    expect(looksLikeGeminiKey('  AIzaTEST-ONLY-not-a-real-key  ')).toBe(true);
  });

  it('rejects other providers\' key shapes', () => {
    expect(looksLikeGeminiKey('sk-proj-abc123')).toBe(false);
    expect(looksLikeGeminiKey('AQVN0123456789')).toBe(false); // Yandex IAM
    expect(looksLikeGeminiKey('trnsl.1.1.20240101T000000Z.abc')).toBe(false);
    expect(looksLikeGeminiKey('abcdef123:fx')).toBe(false); // DeepL
    expect(looksLikeGeminiKey('')).toBe(false);
  });
});

describe('hedged model race', () => {
  it('a hanging first model no longer blocks the whole call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('gemini-flash-latest')) return new Promise<Response>(() => {}); // hangs
        return ok('مرحبا');
      })
    );
    const start = Date.now();
    const text = await geminiTranslateDirect({ apiKey: 'k', sourceText: 'Hello' });
    const elapsed = Date.now() - start;
    expect(text).toBe('مرحبا');
    // hedged: answered by the second candidate after the 4s stagger, not after the 30s timeout
    expect(elapsed).toBeLessThan(15000);
  }, 20000);

  it('a fast-failing model brings the next candidate in without waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('gemini-flash-latest')) return err(503, 'high demand');
        return ok('مرحبا');
      })
    );
    const start = Date.now();
    expect(await geminiTranslateDirect({ apiKey: 'k', sourceText: 'Hello' })).toBe('مرحبا');
    expect(Date.now() - start).toBeLessThan(3500); // no 4s hedge wait after a fast failure
  });

  it('a bad key fails fast without waiting out the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => err(403, 'API key not valid. Please pass a valid API key.')));
    const start = Date.now();
    await expect(geminiTranslateDirect({ apiKey: 'bad', sourceText: 'Hello' })).rejects.toThrow(/not valid|غير صالح/i);
    expect(Date.now() - start).toBeLessThan(3500);
  });
});

describe('geminiThinkingConfig', () => {
  it('sends the level as thinkingLevel for any model (validity is probed at runtime)', () => {
    expect(geminiThinkingConfig('low')).toEqual({ thinkingLevel: 'low' });
    expect(geminiThinkingConfig('minimal')).toEqual({ thinkingLevel: 'minimal' });
    expect(geminiThinkingConfig('xhigh')).toEqual({ thinkingLevel: 'xhigh' });
  });

  it('leaves the model default for auto/empty/unknown levels', () => {
    expect(geminiThinkingConfig('auto')).toBeUndefined();
    expect(geminiThinkingConfig(undefined)).toBeUndefined();
    expect(geminiThinkingConfig('')).toBeUndefined();
    expect(geminiThinkingConfig('ultra')).toBeUndefined();
  });
});

describe('pinned model and thinking level', () => {
  it('calls the pinned model first with its thinking config', async () => {
    const calls: Array<{ url: string; body: { model?: string; generationConfig?: { thinkingConfig?: unknown } } }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init?.body || '{}')) });
        return ok('مرحبا');
      })
    );
    const text = await geminiTranslateDirect({
      apiKey: 'k',
      sourceText: 'Hello',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'low',
    });
    expect(text).toBe('مرحبا');
    expect(calls[0].url).toContain('gemini-3.8-flash');
    expect(calls[0].body.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('retries without the thinking config when the model rejects it', async () => {
    const bodies: Array<{ generationConfig?: { thinkingConfig?: unknown } }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        bodies.push(body);
        if (body.generationConfig?.thinkingConfig) return err(400, 'Unknown field thinkingLevel in thinking config');
        return ok('مرحبا');
      })
    );
    expect(
      await geminiTranslateDirect({ apiKey: 'k', sourceText: 'Hello', model: 'gemini-3.8-flash', thinkingLevel: 'high' })
    ).toBe('مرحبا');
    expect(bodies).toHaveLength(2);
    expect(bodies[1].generationConfig?.thinkingConfig).toBeUndefined();
  });
});
