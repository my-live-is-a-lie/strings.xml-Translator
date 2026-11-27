// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTranslationCache, setActiveProviderId, suggestTranslation } from '../src/utils/translator';
import { fetchWithTimeout } from '../src/shared/translateCore';

const gtx = (q: string, text: string) =>
  new Response(JSON.stringify([[[text, q, null, null, 1]], null, 'en']), { status: 200 });

beforeEach(() => {
  clearTranslationCache();
  vi.unstubAllGlobals();
});
afterEach(() => {
  setActiveProviderId('google');
});

describe('cancelling an ICU suggestion', () => {
  const SELECT = '{gender, select, male {He} female {She} other {They}} liked your post';

  it('stops sending clause requests once the signal aborts', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const q = new URL(String(url)).searchParams.get('q') ?? '';
        seen.push(q);
        // The user cancels while the first clause body is in flight.
        if (q === 'He') controller.abort();
        return gtx(q, q.startsWith('{gender') ? '{الجنس، اختر، ذكر {987100}}' : 'x');
      })
    );
    await suggestTranslation(SELECT, 'ar', undefined, undefined, controller.signal).catch(() => undefined);
    expect(seen).toContain('He');
    expect(seen).not.toContain('She');
    expect(seen).not.toContain('They');
    expect(seen).not.toContain('liked your post');
  });
});

describe('fetchWithTimeout listener cleanup (manual AbortSignal.any fallback)', () => {
  it('removes its listener from the caller signal once the fetch settles', async () => {
    const original = AbortSignal.any;
    // @ts-expect-error force the fallback path
    AbortSignal.any = undefined;
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
      const caller = new AbortController();
      const added = vi.spyOn(caller.signal, 'addEventListener');
      const removed = vi.spyOn(caller.signal, 'removeEventListener');
      await fetchWithTimeout('https://example.test/', {}, 5000, caller.signal);
      expect(added).toHaveBeenCalledTimes(1);
      expect(removed).toHaveBeenCalledTimes(1);
      expect(removed.mock.calls[0][1]).toBe(added.mock.calls[0][1]);
    } finally {
      AbortSignal.any = original;
    }
  });

  it('still aborts the request when the caller signal fires', async () => {
    const original = AbortSignal.any;
    // @ts-expect-error force the fallback path
    AbortSignal.any = undefined;
    try {
      let seenSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((_u: string, init: RequestInit) => {
          seenSignal = init.signal as AbortSignal;
          return new Promise<Response>((_r, rej) =>
            seenSignal!.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
          );
        })
      );
      const caller = new AbortController();
      const p = fetchWithTimeout('https://example.test/', {}, 5000, caller.signal);
      caller.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
      expect(seenSignal!.aborted).toBe(true);
    } finally {
      AbortSignal.any = original;
    }
  });
});
