import { afterEach, describe, expect, it, vi } from 'vitest';
import { getModelProbeSnapshot, modelProbeCacheKey } from './providerModels';
import { getStoredItem, removeStoredItem, setStoredItem } from './storage';

const ok = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] }), {
    status: 200,
  });

const cleanup = (key: string, model: string) => removeStoredItem(modelProbeCacheKey(key, model));

describe('model probe cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses a persisted fresh probe without any API call', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setStoredItem(
      modelProbeCacheKey('freshkey', 'gemini-fresh-flash'),
      JSON.stringify({ availability: 'ok', levels: ['low', 'high'], at: Date.now() })
    );
    const snap = getModelProbeSnapshot('gemini', 'freshkey', 'gemini-fresh-flash');
    expect(snap).toEqual({ availability: 'ok', levels: ['low', 'high'], definite: true });
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup('freshkey', 'gemini-fresh-flash');
  });

  it('probes once, persists the result, and serves later callers from cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    expect(getModelProbeSnapshot('gemini', 'persistkey', 'gemini-p-flash')).toBe('loading');
    await vi.waitFor(() => {
      expect(getModelProbeSnapshot('gemini', 'persistkey', 'gemini-p-flash')).not.toBe('loading');
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const persisted = getStoredItem(modelProbeCacheKey('persistkey', 'gemini-p-flash'));
    expect(persisted).toBeTruthy();
    expect(JSON.parse(persisted as string).levels).toHaveLength(5);
    cleanup('persistkey', 'gemini-p-flash');
  });

  it('ignores an expired probe and re-probes', async () => {
    setStoredItem(
      modelProbeCacheKey('oldkey', 'gemini-old-flash'),
      JSON.stringify({ availability: 'ok', levels: ['low'], at: Date.now() - 25 * 60 * 60 * 1000 })
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));
    expect(getModelProbeSnapshot('gemini', 'oldkey', 'gemini-old-flash')).toBe('loading');
    await vi.waitFor(() => {
      const snap = getModelProbeSnapshot('gemini', 'oldkey', 'gemini-old-flash');
      expect(snap).not.toBe('loading');
      expect(snap && snap !== 'loading' ? snap.levels : []).toHaveLength(5);
    });
    cleanup('oldkey', 'gemini-old-flash');
  });

  it('never persists an inconclusive probe (transient errors must not mark a model)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    expect(getModelProbeSnapshot('gemini', 'flakykey', 'gemini-f-flash')).toBe('loading');
    await vi.waitFor(() => {
      expect(getModelProbeSnapshot('gemini', 'flakykey', 'gemini-f-flash')).not.toBe('loading');
    });
    expect(getStoredItem(modelProbeCacheKey('flakykey', 'gemini-f-flash'))).toBeNull();
    cleanup('flakykey', 'gemini-f-flash');
  });

  it('drops a malformed cache entry', () => {
    setStoredItem(modelProbeCacheKey('badkey', 'gemini-bad-flash'), '{not json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));
    expect(getModelProbeSnapshot('gemini', 'badkey', 'gemini-bad-flash')).toBe('loading');
    cleanup('badkey', 'gemini-bad-flash');
  });
});
