import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyGeminiKeyProblem,
  isModelQuotaMessage,
  geminiThinkingConfig,
  geminiTranslateDirect,
  GEMINI_THINKING_LEVELS,
  listGeminiModels,
  probeGeminiModel,
  testGeminiKeyDirect,
} from './geminiDirect';

describe('classifyGeminiKeyProblem', () => {
  it('names invalid keys and exhausted quota, but not plain rate limits', () => {
    expect(classifyGeminiKeyProblem(401, 'API key not valid')).toBe('invalid-key');
    expect(classifyGeminiKeyProblem(400, 'API key not valid. Please pass a valid API key.')).toBe(
      'invalid-key'
    );
    expect(classifyGeminiKeyProblem(400, 'API_KEY_INVALID')).toBe('invalid-key');
    expect(classifyGeminiKeyProblem(403, 'API key expired. Please renew the API key.')).toBe(
      'expired-key'
    );
    // Key/account-wide daily quota names the project or the account: that is a key problem.
    expect(
      classifyGeminiKeyProblem(429, 'Quota exceeded for metric: generate_requests_per_project_per_day')
    ).toBe('quota-exhausted');
    // The generic plan/billing wording is what a per-model limit-0 answers on some models
    // (verified live: lite models answer 200 for the same key in the same burst): not a key problem.
    expect(
      classifyGeminiKeyProblem(429, 'You exceeded your current quota, please check your plan and billing details')
    ).toBeNull();
    expect(
      isModelQuotaMessage(429, 'You exceeded your current quota, please check your plan and billing details')
    ).toBe(true);
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
              model('gemini-3.1-flash-lite-preview'),
              model('gemini-3.1-pro-preview'),
              model('gemini-2.5-pro'),
              model('gemini-3.1-pro-preview-customtools'),
              model('gemini-4-argon'),
              model('gemini-4-carbon'),
              model('gemini-2.0-flash-exp'),
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
    // preview releases of real families stay
    expect(names).toContain('gemini-3.1-flash-lite-preview');
    expect(names).toContain('gemini-3.1-pro-preview');
    expect(names).toContain('gemini-2.5-pro');
    // The API reports generateContent for these: they are real text models and must show,
    // whatever their names look like. The lazy probe decides whether they answer for this key.
    expect(names).toContain('gemini-3.1-pro-preview-customtools');
    expect(names).toContain('gemini-4-argon');
    expect(names).toContain('gemini-4-carbon');
    expect(names).toContain('gemini-2.0-flash-exp');
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
    // newest version first; within one version the general-purpose families come first
    expect(names.indexOf('gemini-4-argon')).toBeLessThan(names.indexOf('gemini-3.1-flash'));
    expect(names.indexOf('gemini-3.1-flash')).toBeLessThan(names.indexOf('gemini-3.1-pro'));
  });
});

describe('geminiTranslateDirect model failure reporting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const translateOk = () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'مرحبا' }] } }] }), {
      status: 200,
    });

  it('reports a pinned model that 404s and still translates via failover', async () => {
    const calls: Array<[string, string]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('gemini-dead-pro') ? err(404, 'models/gemini-dead-pro is not found') : translateOk()
      )
    );
    const out = await geminiTranslateDirect({
      apiKey: 'k',
      sourceText: 'Hello',
      model: 'gemini-dead-pro',
      onModelDefiniteFailure: (m, kind) => calls.push([m, kind]),
    });
    expect(out).toBe('مرحبا');
    expect(calls).toEqual([['gemini-dead-pro', 'unavailable']]);
  });

  it('reports a model-scoped quota as model-quota, never as a key problem', async () => {
    const calls: Array<[string, string]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('gemini-quota-pro')
          ? err(
              429,
              'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 0, model: gemini-quota-pro'
            )
          : translateOk()
      )
    );
    const out = await geminiTranslateDirect({
      apiKey: 'k',
      sourceText: 'Hello',
      model: 'gemini-quota-pro',
      onModelDefiniteFailure: (m, kind) => calls.push([m, kind]),
    });
    expect(out).toBe('مرحبا');
    expect(calls).toEqual([['gemini-quota-pro', 'model-quota']]);
  });

  it('never reports transient failures', async () => {
    const calls: Array<[string, string]> = [];
    let failedOnce = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('gemini-flaky') && !failedOnce) {
          failedOnce = true;
          return err(503, 'The model is overloaded');
        }
        return translateOk();
      })
    );
    const out = await geminiTranslateDirect({
      apiKey: 'k',
      sourceText: 'Hello',
      model: 'gemini-flaky',
      onModelDefiniteFailure: (m, kind) => calls.push([m, kind]),
    });
    expect(out).toBe('مرحبا');
    expect(calls).toEqual([]);
  });
});

describe('testGeminiKeyDirect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const listOk = (names: string[]) =>
    new Response(
      JSON.stringify({
        models: names.map((name) => ({
          name: `models/${name}`,
          supportedGenerationMethods: ['generateContent'],
          description: 'General-purpose text model',
        })),
      }),
      { status: 200 }
    );
  const MODELS = ['gemini-3.1-pro-preview', 'gemini-3.1-flash', 'gemini-2.5-flash'];
  const modelScopedQuota = (model: string) =>
    err(
      429,
      `Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 0, model: ${model}`
    );
  const modelIn = (url: string) => /models\/([^:?]+):/.exec(url)?.[1] ?? '';

  it('accepts the key when the first probed model is quota-limited but another works', async () => {
    // The exact real-world case: the verification probe hit a model whose per-model daily quota
    // is 0 on this plan, and the old code failed the whole key for it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/models?')) return listOk(MODELS);
        const m = modelIn(url);
        if (m === 'gemini-3.1-flash') return ok();
        if (MODELS.includes(m)) return modelScopedQuota(m);
        return err(404, `models/${m} is not found`); // stale workingModel / built-ins
      })
    );
    const res = await testGeminiKeyDirect('k');
    expect(res.success).toBe(true);
    expect(res.matched).toBe(true);
    expect(res.errorKind).toBeUndefined();
    expect(res.modelsQuotaLimited).toBeUndefined();
    expect(res.workingModel).toBe('gemini-3.1-flash');
  });

  it('accepts the key when every model answers a model-scoped quota', async () => {
    // Quota is enforced per key, so a quota answer proves the key authenticated: accept it and
    // let the picker mark models as they are probed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/models?')) return listOk(MODELS);
        return modelScopedQuota(modelIn(url) || 'gemini-flash-latest');
      })
    );
    const res = await testGeminiKeyDirect('k');
    expect(res.success).toBe(true);
    expect(res.modelsQuotaLimited).toBe(true);
    expect(res.errorKind).toBeUndefined();
    expect(res.workingModel).toBeUndefined();
  });

  it('accepts the key when every candidate model is gone (404)', async () => {
    // The API answered every call, so the key works; there is just no usable model right now.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/models?')) return listOk(MODELS);
        const m = modelIn(url) || 'unknown';
        return err(404, `models/${m} is not found`);
      })
    );
    const res = await testGeminiKeyDirect('k');
    expect(res.success).toBe(true);
    expect(res.noWorkingModel).toBe(true);
    expect(res.errorKind).toBeUndefined();
  });

  it('reports a provider-side outage as provider-error, never a key verdict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/models?')) return listOk(MODELS);
        return err(500, 'internal error');
      })
    );
    const res = await testGeminiKeyDirect('k');
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('provider-error');
  });

  it('rejects an invalid key with a categorized errorKind (Google answers 400)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/models?')) return err(400, 'API key not valid. Please pass a valid API key.');
        return err(400, 'API key not valid. Please pass a valid API key.');
      })
    );
    const res = await testGeminiKeyDirect('k');
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('invalid-key');
  });

  it('rejects a key-wide exhausted quota as quota-exhausted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/models?')) return listOk(MODELS);
        return err(
          429,
          'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_project_per_day, limit: 50'
        );
      })
    );
    const res = await testGeminiKeyDirect('k');
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('quota-exhausted');
  });

  it('reports a network failure as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const res = await testGeminiKeyDirect('k');
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('unreachable');
  });

  it('races the discovered model list instead of the built-in candidates', async () => {
    const called: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/models?')) return listOk(['gemini-9.9-flash']);
        const m = modelIn(url);
        if (m) called.push(m);
        if (m === 'gemini-9.9-flash') return ok();
        return err(404, `models/${m} is not found`);
      })
    );
    const res = await testGeminiKeyDirect('k');
    expect(res.success).toBe(true);
    expect(called).toContain('gemini-9.9-flash');
    // The built-in candidates were never the plan's only hope.
    expect(res.workingModel).toBe('gemini-9.9-flash');
  });
});

describe('geminiTranslateDirect failover reporting scope', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks only the model the user picked, never failover or discovery candidates', async () => {
    const calls: Array<[string, string]> = [];
    const quota = (m: string) =>
      err(
        429,
        `Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 0, model: ${m}`
      );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/models?')) {
          return new Response(
            JSON.stringify({
              models: [{ name: 'models/gemini-9.9-flash', supportedGenerationMethods: ['generateContent'] }],
            }),
            { status: 200 }
          );
        }
        const m = /models\/([^:?]+):/.exec(url)?.[1] ?? '';
        if (m === 'gemini-9.9-flash') return ok();
        return quota(m || 'unknown'); // the picked model and every built-in candidate
      })
    );
    const out = await geminiTranslateDirect({
      apiKey: 'k',
      sourceText: 'Hello',
      model: 'gemini-user-picked',
      onModelDefiniteFailure: (m, kind) => calls.push([m, kind]),
    });
    // The call succeeds through failover, and only the user's own pick is reported.
    expect(out).toBe('Hi');
    expect(calls).toEqual([['gemini-user-picked', 'model-quota']]);
  });
});
