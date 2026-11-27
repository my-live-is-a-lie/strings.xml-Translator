import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testProviderApiKey } from '../src/utils/translator';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => vi.stubGlobal('window', {}));
afterEach(() => vi.unstubAllGlobals());

describe('testProviderApiKey (server path)', () => {
  it('returns the server reason when the server refuses the key, not a generic "unreachable"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { success: false, matched: false, error: 'DeepL API: Invalid key (HTTP 403)' })));
    const r = await testProviderApiKey('deepl', 'k:fx');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Invalid key (HTTP 403)');
  });
  it('keeps a categorized key problem from the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { success: false, matched: false, errorKind: 'quota-or-limit', error: 'x' })));
    expect((await testProviderApiKey('lara', 'a:b')).errorKind).toBe('quota-or-limit');
  });
  it('passes the abort signal to the request and stops after a cancel', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(init?.signal);
        await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
        return json(200, {});
      })
    );
    const ctrl = new AbortController();
    const p = testProviderApiKey('deepl', 'k:fx', undefined, ctrl.signal);
    await Promise.resolve();
    ctrl.abort();
    const r = await p;
    expect(seen.length).toBe(1);
    expect(r.success).toBe(false);
    expect((vi.mocked(fetch) as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });
});
