import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearModelUnavailableError,
  clearProviderRuntimeError,
  clearProviderRuntimeErrorOnSuccess,
  getModelProbeSnapshot,
  getProviderRuntimeErrorsSnapshot,
  modelProbeCacheKey,
  peekModelProbe,
  reportModelDefiniteFailure,
} from './providerModels';
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

  it('persists a model-scoped quota so the unavailable group survives reloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                'Quota exceeded for metric: generate_requests_per_model_per_day, limit: 0, model: gemini-p-pro',
            },
          }),
          { status: 429 }
        )
      )
    );
    expect(getModelProbeSnapshot('gemini', 'quotakey', 'gemini-p-pro')).toBe('loading');
    await vi.waitFor(() => {
      expect(getModelProbeSnapshot('gemini', 'quotakey', 'gemini-p-pro')).not.toBe('loading');
    });
    const persisted = getStoredItem(modelProbeCacheKey('quotakey', 'gemini-p-pro'));
    expect(persisted).toBeTruthy();
    expect(JSON.parse(persisted as string).modelQuota).toBe(true);
    // And a peek (no API call) reports the same group state.
    const peeked = peekModelProbe('gemini', 'quotakey', 'gemini-p-pro');
    expect(peeked?.modelQuota).toBe(true);
    cleanup('quotakey', 'gemini-p-pro');
  });

  it('reportModelDefiniteFailure moves the model to unavailable and onto the card', () => {
    reportModelDefiniteFailure('prov1', 'gemini', 'rtkey', 'gemini-rt-pro', 'unavailable');
    expect(peekModelProbe('gemini', 'rtkey', 'gemini-rt-pro')?.availability).toBe('unavailable');
    const persisted = JSON.parse(getStoredItem(modelProbeCacheKey('rtkey', 'gemini-rt-pro')) as string);
    expect(persisted.availability).toBe('unavailable');
    const card = getProviderRuntimeErrorsSnapshot().get('prov1');
    expect(card?.kind).toBe('model-unavailable');
    expect(card?.model).toBe('gemini-rt-pro');
    clearProviderRuntimeError('prov1');
    expect(getProviderRuntimeErrorsSnapshot().get('prov1')).toBeUndefined();
    cleanup('rtkey', 'gemini-rt-pro');
  });

  it('reportModelDefiniteFailure with model-quota persists the group membership', () => {
    reportModelDefiniteFailure('prov2', 'gemini', 'rtkey2', 'gemini-rt-pro', 'model-quota');
    expect(peekModelProbe('gemini', 'rtkey2', 'gemini-rt-pro')?.modelQuota).toBe(true);
    const persisted = JSON.parse(getStoredItem(modelProbeCacheKey('rtkey2', 'gemini-rt-pro')) as string);
    expect(persisted.modelQuota).toBe(true);
    clearProviderRuntimeError('prov2');
    cleanup('rtkey2', 'gemini-rt-pro');
  });

  it('clearProviderRuntimeErrorOnSuccess keeps the line while the pinned model is still broken', () => {
    reportModelDefiniteFailure('prov3', 'gemini', 'rtkey3', 'gemini-rt-pro', 'unavailable');
    // Failover success with the broken model still pinned: the line stays.
    clearProviderRuntimeErrorOnSuccess('prov3', 'gemini-rt-pro');
    expect(getProviderRuntimeErrorsSnapshot().get('prov3')?.kind).toBe('model-unavailable');
    // Success after the user moved to another model: the line clears.
    clearProviderRuntimeErrorOnSuccess('prov3', 'gemini-rt-flash');
    expect(getProviderRuntimeErrorsSnapshot().get('prov3')).toBeUndefined();
    // A successful re-test clears the line for that model only.
    reportModelDefiniteFailure('prov3', 'gemini', 'rtkey3', 'gemini-rt-pro', 'unavailable');
    clearModelUnavailableError('prov3', 'gemini-rt-pro');
    expect(getProviderRuntimeErrorsSnapshot().get('prov3')).toBeUndefined();
    cleanup('rtkey3', 'gemini-rt-pro');
  });

  it('force re-probes a cached model and overwrites the group when it recovers', async () => {
    setStoredItem(
      modelProbeCacheKey('rekey', 'gemini-re-pro'),
      JSON.stringify({ availability: 'unknown', levels: ['low'], modelQuota: true, at: Date.now() })
    );
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    // Without force the cache is served and nothing is called.
    const cached = getModelProbeSnapshot('gemini', 'rekey', 'gemini-re-pro');
    expect(cached && cached !== 'loading' ? cached.modelQuota : false).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    // With force the probe runs again and the recovered model is persisted as available.
    expect(getModelProbeSnapshot('gemini', 'rekey', 'gemini-re-pro', { force: true })).toBe('loading');
    await vi.waitFor(() => {
      const snap = getModelProbeSnapshot('gemini', 'rekey', 'gemini-re-pro');
      expect(snap && snap !== 'loading' ? snap.availability : '').toBe('ok');
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const persisted = JSON.parse(getStoredItem(modelProbeCacheKey('rekey', 'gemini-re-pro')) as string);
    expect(persisted.availability).toBe('ok');
    expect(persisted.modelQuota).toBeFalsy();
    cleanup('rekey', 'gemini-re-pro');
  });
});
