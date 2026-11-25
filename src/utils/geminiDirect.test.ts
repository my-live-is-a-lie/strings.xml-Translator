import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyGeminiKeyProblem,
  geminiThinkingConfig,
  GEMINI_THINKING_LEVELS,
  listGeminiModels,
  probeGeminiModel,
} from './geminiDirect';

describe('classifyGeminiKeyProblem', () => {
  it('names invalid keys and exhausted quota, but not plain rate limits', () => {
    expect(classifyGeminiKeyProblem(401, 'API key not valid')).toBe('invalid-key');
    expect(classifyGeminiKeyProblem(403, 'API key expired. Please renew the API key.')).toBe(
      'expired-key'
    );
    // Key/account-wide daily quota names the project or the account: that is a key problem.
    expect(
      classifyGeminiKeyProblem(429, 'Quota exceeded for metric: generate_requests_per_project_per_day')
    ).toBe('quota-exhausted');
    expect(
      classifyGeminiKeyProblem(429, 'You exceeded your current quota, please check your plan and billing details')
    ).toBe('quota-exhausted');
    // A model-scoped daily quota (limit 0 on the free tier) says nothing about the key.
    expect(
      classifyGeminiKeyProblem(
        429,
        'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 0, model: gemini-3.1-pro'
      )
    ).toBeNull();
    expect(classifyGeminiKeyProblem(429, 'Quota exceeded for metric: generate_requests_per_model_per_minute')).toBeNull();
    expect(classifyGeminiKeyProblem(404, 'models/x is not found')).toBeNull();
    expect(classifyGeminiKeyProblem(500, 'internal')).toBeNull();
  });
});

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
    expect(result.definite).toBe(true);
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
    expect(result.definite).toBe(true);
  });

  it('keeps levels on transient errors so a rate limit hides nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(err(429, 'quota exceeded')));
    const result = await probeGeminiModel('key', 'gemini-x-flash');
    expect(result.availability).toBe('unknown');
    expect(result.levels).toEqual([...GEMINI_THINKING_LEVELS]);
    expect(result.definite).toBe(false);
    expect(result.modelQuota).toBeFalsy();
  });

  it('flags a model-scoped quota (limit 0 per model) without blaming the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        err(
          429,
          'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 0, model: gemini-3.1-pro'
        )
      )
    );
    const result = await probeGeminiModel('key', 'gemini-3.1-pro');
    // The pick stays possible, the key is not blamed, and nothing definite is cached: the daily
    // quota resets and a different model on the same key can work fine.
    expect(result.availability).toBe('unknown');
    expect(result.modelQuota).toBe(true);
    expect(result.keyProblem).toBeNull();
    expect(result.definite).toBe(false);
    expect(result.levels).toEqual([...GEMINI_THINKING_LEVELS]);
  });

  it('treats a per-minute rate limit as transient, never as quota', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        err(429, 'Quota exceeded for metric: generate_requests_per_model_per_minute, limit: 25')
      )
    );
    const result = await probeGeminiModel('key', 'gemini-x-flash');
    expect(result.modelQuota).toBeFalsy();
    expect(result.keyProblem).toBeNull();
    expect(result.availability).toBe('unknown');
  });

  it('does not flag model-quota when any probe answers differently', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return calls === 1
          ? ok()
          : err(429, 'Quota exceeded for metric: generate_requests_per_model_per_day, limit: 0, model: gemini-x-flash');
      })
    );
    const result = await probeGeminiModel('key', 'gemini-x-flash');
    expect(result.availability).toBe('ok');
    expect(result.modelQuota).toBeFalsy();
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
    // one probe failed over the network, so the result is not definite and must not be cached
    expect(result.definite).toBe(false);
  });
});

describe('listGeminiModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const model = (name: string, description = 'Text model') => ({
    name: `models/${name}`,
    supportedGenerationMethods: ['generateContent'],
    thinking: true,
    description,
  });

  it('keeps text models and drops non-text variants, aliases and audio/image models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            models: [
              model('gemini-3.1-flash'),
              model('gemini-3.1-pro'),
              model('gemini-2.5-flash', 'Fast multimodal model: accepts text, images and audio as input'),
              model('gemini-3.5-transcribe', 'Transcribes audio to text'),
              model('gemini-nano-banana-2.1', 'Generates images from text prompts'),
              model('gemini-omni-2.0', 'Omni-modal with audio output'),
              model('gemini-flash-latest'),
              model('gemini-2.0-tts', 'Text to speech'),
              model('gemini-robotics-er-1'),
              { name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
            ],
          }),
          { status: 200 }
        )
      )
    );
    const names = (await listGeminiModels('key')).map((m) => m.name);
    expect(names).toContain('gemini-3.1-flash');
    expect(names).toContain('gemini-3.1-pro');
    // multimodal input must NOT drop a text-output model
    expect(names).toContain('gemini-2.5-flash');
    for (const dropped of [
      'gemini-3.5-transcribe',
      'gemini-nano-banana-2.1',
      'gemini-omni-2.0',
      'gemini-flash-latest',
      'gemini-2.0-tts',
      'gemini-robotics-er-1',
      'gemini-embedding-2',
    ]) {
      expect(names).not.toContain(dropped);
    }
    // flash family first, newest version first
    expect(names.indexOf('gemini-3.1-flash')).toBeLessThan(names.indexOf('gemini-3.1-pro'));
  });
});
