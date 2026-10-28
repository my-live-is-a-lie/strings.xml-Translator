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
});
