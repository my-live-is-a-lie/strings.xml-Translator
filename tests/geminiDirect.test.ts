import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiTranslateDirect, isModelUnavailableMessage } from '../src/utils/geminiDirect';

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
    await expect(geminiTranslateDirect({ apiKey: 'bad', sourceText: 'Hello' })).rejects.toThrow(/API key not valid/);
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
