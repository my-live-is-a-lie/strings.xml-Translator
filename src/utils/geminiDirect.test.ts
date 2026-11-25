import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiThinkingConfig, GEMINI_THINKING_LEVELS, probeGeminiModel } from './geminiDirect';

const ok = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] }), {
    status: 200,
  });
const err = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), { status });

describe('geminiThinkingConfig', () => {
  it('sends any API enum level as thinkingLevel, regardless of model', () => {
    for (const level of GEMINI_THINKING_LEVELS) {
      expect(geminiThinkingConfig(level)).toEqual({ thinkingLevel: level });
    }
  });

  it('leaves the model default for auto/empty/unknown levels', () => {
    expect(geminiThinkingConfig('auto')).toBeUndefined();
    expect(geminiThinkingConfig(undefined)).toBeUndefined();
    expect(geminiThinkingConfig('')).toBeUndefined();
    expect(geminiThinkingConfig('ultra')).toBeUndefined();
  });
});

describe('probeGeminiModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts every level the model answers, in parallel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    const result = await probeGeminiModel('key', 'gemini-x-flash');
    expect(result.availability).toBe('ok');
    expect(result.levels).toEqual([...GEMINI_THINKING_LEVELS]);
    expect(fetchMock).toHaveBeenCalledTimes(GEMINI_THINKING_LEVELS.length);
  });

  it('drops levels the model rejects with a 400 about thinking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        const level = body.generationConfig?.thinkingConfig?.thinkingLevel;
        return level === 'minimal' || level === 'xhigh'
          ? err(400, `Invalid value at thinking_config.thinking_level: ${level}`)
          : ok();
      })
    );
    const result = await probeGeminiModel('key', 'gemini-x-flash');
    expect(result.availability).toBe('ok');
    expect(result.levels).toEqual(['low', 'medium', 'high']);
  });

  it('reports the model unavailable when every probe 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(err(404, 'models/gemini-old is not found'))
    );
    const result = await probeGeminiModel('key', 'gemini-old');
    expect(result.availability).toBe('unavailable');
    expect(result.levels).toEqual([]);
  });

  it('keeps levels on transient errors so a rate limit hides nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(err(429, 'quota exceeded')));
    const result = await probeGeminiModel('key', 'gemini-x-flash');
    expect(result.availability).toBe('unknown');
    expect(result.levels).toEqual([...GEMINI_THINKING_LEVELS]);
  });

  it('keeps a level whose probe failed over the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.generationConfig?.thinkingConfig?.thinkingLevel === 'high') {
          throw new Error('offline');
        }
        return ok();
      })
    );
    const result = await probeGeminiModel('key', 'gemini-x-flash');
    expect(result.availability).toBe('ok');
    expect(result.levels).toContain('high');
  });
});
