import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  geminiThinkingConfig,
  geminiThinkingLevelsForModel,
  keepLatestGeneration,
  probeGeminiModel,
} from './geminiDirect';

describe('geminiThinkingLevelsForModel', () => {
  it('matches the per-model table from the Gemini thinking docs', () => {
    expect(geminiThinkingLevelsForModel('gemini-3-flash-preview')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(geminiThinkingLevelsForModel('gemini-3.6-flash')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    // minimal is not supported on 3.8-flash
    expect(geminiThinkingLevelsForModel('gemini-3.8-flash')).toEqual(['low', 'medium', 'high']);
    expect(geminiThinkingLevelsForModel('gemini-3-pro-preview')).toEqual(['low', 'high']);
    expect(geminiThinkingLevelsForModel('gemini-3.1-pro-preview')).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(geminiThinkingLevelsForModel('gemini-4-hydrogen')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('gives unknown models the safe middle set', () => {
    expect(geminiThinkingLevelsForModel('gemini-9-future')).toEqual(['low', 'medium', 'high']);
    expect(geminiThinkingLevelsForModel(undefined)).toEqual(['low', 'medium', 'high']);
  });
});

describe('geminiThinkingConfig', () => {
  it('rejects a level the model does not support', () => {
    expect(geminiThinkingConfig('gemini-3.8-flash', 'minimal')).toBeUndefined();
    expect(geminiThinkingConfig('gemini-3.8-flash', 'low')).toEqual({ thinkingLevel: 'low' });
    expect(geminiThinkingConfig('gemini-3-flash-preview', 'minimal')).toEqual({
      thinkingLevel: 'minimal',
    });
    expect(geminiThinkingConfig('gemini-4-hydrogen', 'xhigh')).toEqual({ thinkingLevel: 'xhigh' });
  });

  it('maps levels to a numeric budget on 2.5 and leaves auto alone', () => {
    expect(geminiThinkingConfig('gemini-2.5-flash', 'low')).toEqual({ thinkingBudget: 1024 });
    expect(geminiThinkingConfig('gemini-3.8-flash', 'auto')).toBeUndefined();
  });
});

describe('keepLatestGeneration', () => {
  it('keeps only the newest major generation the endpoint returned', () => {
    expect(
      keepLatestGeneration([
        'gemini-3.8-flash',
        'gemini-3-flash-preview',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-1.5-flash',
      ])
    ).toEqual(['gemini-3.8-flash', 'gemini-3-flash-preview']);
  });

  it('drops versionless aliases (auto already races them)', () => {
    expect(keepLatestGeneration(['gemini-flash-latest', 'gemini-3.8-flash'])).toEqual([
      'gemini-3.8-flash',
    ]);
  });

  it('falls back to the older generation when it is the only one listed', () => {
    expect(keepLatestGeneration(['gemini-2.5-flash', 'gemini-2.5-pro'])).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);
  });

  it('returns [] for an empty or alias-only list', () => {
    expect(keepLatestGeneration([])).toEqual([]);
    expect(keepLatestGeneration(['gemini-flash-latest'])).toEqual([]);
  });
});

describe('probeGeminiModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok when the model answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] }), {
          status: 200,
        })
      )
    );
    expect(await probeGeminiModel('key', 'gemini-3.8-flash')).toBe('ok');
  });

  it('returns unavailable when the API says the model is retired (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'models/gemini-2.5-flash is not found' } }), {
          status: 404,
        })
      )
    );
    expect(await probeGeminiModel('key', 'gemini-2.5-flash')).toBe('unavailable');
  });

  it('returns unknown on rate limits and server errors so the pick is still saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    expect(await probeGeminiModel('key', 'gemini-3.8-flash')).toBe('unknown');
  });

  it('returns unknown on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await probeGeminiModel('key', 'gemini-3.8-flash')).toBe('unknown');
  });
});
