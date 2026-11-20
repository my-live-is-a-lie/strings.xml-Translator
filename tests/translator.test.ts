// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkTranslateItems,
  clearTranslationCache,
  gtxLooksUnavailable,
  isRetryableError,
  suggestTranslation,
  withRetry,
} from '../src/utils/translator';
import type { PluralStringItem, ResourceItem, SingleStringItem } from '../src/types';

const gtxOk = (text: string) =>
  new Response(JSON.stringify([[[text, 'src', null, null, 1]], null, 'en']), { status: 200 });
const gtxErr = (status: number) => new Response('{}', { status });
const myMemoryOk = (text: string) =>
  new Response(JSON.stringify({ responseData: { translatedText: text }, matches: [] }), { status: 200 });

function stringItem(id: string, source: string): SingleStringItem {
  return { id, name: id, type: 'string', order: 0, status: 'untranslated', source, target: '' };
}

beforeEach(() => {
  clearTranslationCache();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isRetryableError', () => {
  it('retries rate limits, timeouts and server errors', () => {
    expect(isRetryableError(new Error('Google Translate HTTP 429'))).toBe(true);
    expect(isRetryableError(new Error('Gemini: Rate limit reached (HTTP 429)'))).toBe(true);
    expect(isRetryableError(new Error('DeepL: Request failed (HTTP 503)'))).toBe(true);
    expect(isRetryableError(new Error('Google Translate HTTP 500'))).toBe(true);
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
    const abort = new Error('The operation timed out');
    abort.name = 'AbortError';
    expect(isRetryableError(abort)).toBe(true);
  });

  it('does not retry auth errors, bad requests or unknown errors', () => {
    expect(isRetryableError(new Error('Gemini: Invalid key (HTTP 401)'))).toBe(false);
    expect(isRetryableError(new Error('DeepL: Request failed (HTTP 400)'))).toBe(false);
    expect(isRetryableError(new Error('Gemini: Empty translation response'))).toBe(false);
    expect(isRetryableError(new Error('something else'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('succeeds after retryable failures', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new TypeError('Failed to fetch');
        return 'done';
      },
      { baseDelayMs: 1 }
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('throws immediately on a non-retryable error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('Gemini: Invalid key (HTTP 401)');
        },
        { baseDelayMs: 1 }
      )
    ).rejects.toThrow(/Invalid key/);
    expect(calls).toBe(1);
  });

  it('gives up after the max attempts', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('Google Translate HTTP 429');
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow(/429/);
    expect(calls).toBe(3);
  });
});

describe('suggestTranslation retries transient failures', () => {
  it('retries a 429 from Google GTX and then succeeds', async () => {
    let gtxCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) {
          gtxCalls++;
          return gtxCalls < 3 ? gtxErr(429) : gtxOk('الثعلب البني السريع');
        }
        return myMemoryOk('should not be reached');
      })
    );
    const res = await suggestTranslation('A curious purple platypus painted the fence at midnight', 'ar');
    expect(res.text).toBe('الثعلب البني السريع');
    expect(res.source).toBe('google');
    expect(gtxCalls).toBe(3);
  });

  it('does not retry a 401 from Google GTX, falls back to MyMemory', async () => {
    let gtxCalls = 0;
    let myMemoryCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) {
          gtxCalls++;
          return gtxErr(401);
        }
        myMemoryCalls++;
        return myMemoryOk('الثعلب البني السريع');
      })
    );
    const res = await suggestTranslation('A curious purple platypus painted the fence at midnight', 'ar');
    expect(res.text).toBe('الثعلب البني السريع');
    expect(res.source).toBe('mymemory');
    expect(gtxCalls).toBe(1);
    expect(myMemoryCalls).toBe(1);
  });
});

describe('gtxLooksUnavailable counts only failed requests', () => {
  // A pretty-printed plural block: it cannot be split on its line breaks, so the
  // whole-string gates judge the reply as one piece.
  const BLOCK =
    '{count, plural,\n  =0 {No notifications}\n  one {# notification}\n  other {# notifications}\n}';
  const BLOCK_AR =
    '{count, plural,\n  =0 {لا توجد إشعارات}\n  one {# إشعار}\n  other {# إشعارات}\n}';
  // Keywords translated and the breaks dropped: both gates reject this reply.
  const BLOCK_MANGLED = '{عد، جمع، =0 {لا توجد إشعارات} one {# إشعار} other {# إشعارات}}';

  // The counter is module state with no reset export, so each case starts with one
  // successful GTX reply to bring it back to zero.
  const resetCounter = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) return gtxOk('إعادة تعيين');
        return myMemoryOk('إعادة تعيين');
      })
    );
    const res = await suggestTranslation('Reset the counter', 'ar');
    expect(res.source).toBe('google');
    expect(gtxLooksUnavailable()).toBe(false);
  };

  const gtxRejectsBlock = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) return gtxOk(BLOCK_MANGLED);
        return myMemoryOk(BLOCK_AR);
      })
    );

  // A plain Error is not retryable, so the request fails at once instead of burning
  // 1.5 s of retry backoff per call; the counter increments once per failed request
  // either way, and retry behaviour is covered by the tests above.
  const gtxFails = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) throw new Error('Network down');
        return myMemoryOk('بديل');
      })
    );

  it('three rejected replies in a row do not mark GTX unavailable', async () => {
    await resetCounter();
    gtxRejectsBlock();
    for (let i = 0; i < 3; i++) {
      clearTranslationCache();
      const res = await suggestTranslation(BLOCK, 'ar');
      expect(res.source).toBe('mymemory');
    }
    expect(gtxLooksUnavailable()).toBe(false);
  });

  it('three failed requests in a row mark GTX unavailable', async () => {
    await resetCounter();
    gtxFails();
    for (let i = 0; i < 3; i++) {
      await suggestTranslation(`Failing request ${i}`, 'ar');
    }
    expect(gtxLooksUnavailable()).toBe(true);
  });

  it('a rejected reply after failures resets the count', async () => {
    await resetCounter();
    gtxFails();
    await suggestTranslation('First failure', 'ar');
    await suggestTranslation('Second failure', 'ar');
    expect(gtxLooksUnavailable()).toBe(false);
    // A reply arrived — even one the gates reject — so the engine answered.
    gtxRejectsBlock();
    const res = await suggestTranslation(BLOCK, 'ar');
    expect(res.source).toBe('mymemory');
    // Two more failures still do not reach the threshold: the reply reset the count.
    gtxFails();
    await suggestTranslation('Third failure', 'ar');
    await suggestTranslation('Fourth failure', 'ar');
    expect(gtxLooksUnavailable()).toBe(false);
  });
  it('empty replies with a valid shape count as failures, not answers', async () => {
    // An engine that answers with no text translates nothing: it must not keep resetting the warning.
    await resetCounter();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) return new Response('[[]]', { status: 200 });
        return myMemoryOk('بديل');
      })
    );
    for (let i = 0; i < 3; i++) {
      await suggestTranslation(`Empty reply ${i}`, 'ar');
    }
    expect(gtxLooksUnavailable()).toBe(true);
  });

  it('a non-JSON page with status 200 counts as a failure', async () => {
    await resetCounter();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) return new Response('<html>sorry</html>', { status: 200 });
        return myMemoryOk('بديل');
      })
    );
    for (let i = 0; i < 3; i++) {
      await suggestTranslation(`Html page ${i}`, 'ar');
    }
    expect(gtxLooksUnavailable()).toBe(true);
  });
  it('the warning expires after 10 minutes without a new failure', async () => {
    // Nothing calls GTX while another provider works, so an old streak must not stay on forever.
    await resetCounter();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
      gtxFails();
      for (let i = 0; i < 3; i++) await suggestTranslation(`Expiring ${i}`, 'ar');
      expect(gtxLooksUnavailable()).toBe(true);

      vi.setSystemTime(new Date('2026-01-01T10:09:00Z'));
      expect(gtxLooksUnavailable()).toBe(true);

      vi.setSystemTime(new Date('2026-01-01T10:11:00Z'));
      expect(gtxLooksUnavailable()).toBe(false);

      // One failure after the old streak ended starts a new streak: it does not re-raise the warning.
      await suggestTranslation('Late failure', 'ar');
      expect(gtxLooksUnavailable()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bulkTranslateItems isolates per-item failures', () => {
  it('a single item that throws does not abort the batch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) return gtxOk('مترجم');
        return myMemoryOk('مترجم');
      })
    );
    const bad = stringItem('bad', 'Broken item source');
    (bad as unknown as { source: unknown }).source = 123; // corrupt data: translation throws
    const items: ResourceItem[] = [
      stringItem('one', 'A curious purple platypus painted the fence at midnight'),
      bad,
      stringItem('three', 'The silent orange cat watched the river all afternoon'),
    ];
    const failed: Array<{ item: ResourceItem; error: unknown }> = [];
    const out = await bulkTranslateItems(items, 'ar', 'Arabic', undefined, (item, error) =>
      failed.push({ item, error })
    );
    expect(out).toHaveLength(3);
    expect((out[0] as SingleStringItem).status).toBe('translated');
    expect((out[0] as SingleStringItem).target).toBe('مترجم');
    // The bad item keeps its original state instead of losing the whole batch
    expect(out[1]).toEqual(bad);
    expect((out[2] as SingleStringItem).status).toBe('translated');
    expect(failed).toHaveLength(1);
    expect(failed[0].item.id).toBe('bad');
    expect(failed[0].error).toBeInstanceOf(TypeError);
  });

  it('a failing plural quantity does not lose the other quantities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) return gtxOk('مترجم');
        return myMemoryOk('مترجم');
      })
    );
    const plural: PluralStringItem = {
      id: 'p1',
      name: 'p1',
      type: 'plural',
      order: 0,
      status: 'untranslated',
      items: [
        { quantity: 'one', source: 'A curious purple platypus painted the fence at midnight', target: '' },
        { quantity: 'other', source: 123 as unknown as string, target: '' },
      ],
    };
    const out = await bulkTranslateItems([plural], 'en', 'English');
    expect(out).toHaveLength(1);
    const result = out[0] as PluralStringItem;
    expect(result.items.find((i) => i.quantity === 'one')?.target).toBe('مترجم');
    expect(result.items.find((i) => i.quantity === 'other')?.target).toBe('');
    expect(result.status).toBe('translated');
  });

  it('translates a normal batch end to end', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('translate.googleapis.com')) return gtxOk('مترجم');
        return myMemoryOk('مترجم');
      })
    );
    const items: ResourceItem[] = [
      stringItem('one', 'A curious purple platypus painted the fence at midnight'),
      stringItem('two', 'The silent orange cat watched the river all afternoon'),
    ];
    const progress: Array<[number, number]> = [];
    const out = await bulkTranslateItems(items, 'ar', 'Arabic', (done, total) => progress.push([done, total]));
    expect(out.map((i) => (i as SingleStringItem).target)).toEqual(['مترجم', 'مترجم']);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });
});
