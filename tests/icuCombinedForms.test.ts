// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTranslationCache, suggestTranslation } from '../src/utils/translator';
import { fillAddedIcuClauses } from '../src/utils/icuSuggest';

/**
 * The combined request for the categories a language adds to a plural. With a machine-translation
 * engine (Google / MyMemory) every clause body goes out on its own, so the same body must reach the
 * network once, not once per category.
 */
describe('combined plural categories with a machine-translation engine', () => {
  beforeEach(() => {
    clearTranslationCache();
    vi.unstubAllGlobals();
  });

  it('sends the shared body once for all added categories', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const q = new URL(String(url)).searchParams.get('q') ?? '';
        seen.push(q);
        const text = q.startsWith('{n, plural') ? 'مشوّه {عد، جمع، صفر {x}}' : q === '# notifications' ? '# إشعارات' : '';
        return new Response(JSON.stringify([[[text, q, null, null, 1]], null, 'en']), { status: 200 });
      })
    );
    const src = '{count, plural, one{# notification} other{# notifications}}';
    const sug = '{count, plural, one{# إشعار} other{# إشعار}}';
    let bodyCalls = 0;
    const out = await fillAddedIcuClauses(
      src,
      sug,
      'ar',
      async () => {
        bodyCalls++;
        return null;
      },
      async (m) => {
        const r = await suggestTranslation(m, 'ar', 'Arabic');
        return r.source === 'heuristic' ? null : r.text;
      }
    );
    expect(seen.filter((q) => q === '# notifications')).toHaveLength(1);
    expect(bodyCalls).toBe(0);
    for (const q of ['zero', 'two', 'few', 'many']) expect(out).toContain(`${q}{# إشعارات}`);
  });
});
