// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTranslationCache,
  saveCustomProviders,
  setActiveProviderId,
  suggestTranslation,
  suggestionRejectedForIcu,
} from '../src/utils/translator';
import { validatePlaceholders } from '../src/utils/placeholderCheck';

/**
 * Phase 3: an ICU string is translated piece by piece when the whole-block reply
 * cannot survive (the machine-translation engines translate the block's keywords,
 * so their reply is always rejected by the structural check). The structure is
 * copied from the source and only the surrounding text and each clause body go
 * through the engines, each on its own.
 *
 * The mock answers like the real Google engine does for a whole block (keywords
 * translated, so the reply is rejected) and from a per-input dictionary for the
 * small pieces. Unknown inputs get an empty reply, i.e. no result — never an
 * echo of the input, which the structural check would accept as "translated".
 */
const MANGLED_SELECT =
  '{الجنس، اختر، ذكر {987100} أنثى {987101} أخرى {987102}} أعجب بمشاركتك';
const MANGLED_PLURAL = 'لديك {عد، جمع، واحدة {# رسالة} أخرى {# رسائل}}';

const routeMock = (dict: Record<string, string>, seen: string[]) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const q = new URL(String(url)).searchParams.get('q') ?? '';
      seen.push(q);
      const isGtx = String(url).includes('translate.googleapis.com');
      let text = dict[q];
      if (text === undefined) {
        if (q.startsWith('{gender, select,')) text = MANGLED_SELECT;
        else if (q.startsWith('You have {count,')) text = MANGLED_PLURAL;
        else text = '';
      }
      if (isGtx) {
        return new Response(JSON.stringify([[[text, q, null, null, 1]], null, 'en']), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ responseData: { translatedText: text }, matches: [] }),
        { status: 200 }
      );
    })
  );

beforeEach(() => {
  clearTranslationCache();
  vi.unstubAllGlobals();
});

afterEach(() => {
  setActiveProviderId('google');
});

describe('per-clause translation of ICU blocks', () => {
  const SELECT = '{gender, select, male {He} female {She} other {They}} liked your post';

  it('translates select clause bodies after the whole-block reply is rejected', async () => {
    const seen: string[] = [];
    routeMock(
      {
        He: 'هو',
        She: 'هي',
        They: 'هم',
        'liked your post': 'أعجبهم منشورك',
      },
      seen
    );
    const res = await suggestTranslation(SELECT, 'ar');
    expect(res.text).toBe('{gender, select, male {هو} female {هي} other {هم}} أعجبهم منشورك');
    expect(res.source).toBe('google');
    expect(suggestionRejectedForIcu()).toBe(false);
    expect(validatePlaceholders(SELECT, res.text, 'ar').valid).toBe(true);
    // The whole block went out masked, was rejected, and each piece went out on its own.
    expect(seen).toContain('{gender, select, male 987100 female 987101 other 987102} liked your post');
    expect(seen).toContain('He');
    expect(seen).toContain('liked your post');
  });

  it('translates plural bodies and keeps the #', async () => {
    const seen: string[] = [];
    routeMock(
      {
        'You have': 'لديك',
        '# message': '# رسالة',
        '# messages': '# رسائل',
      },
      seen
    );
    const res = await suggestTranslation(
      'You have {count, plural, one {# message} other {# messages}}',
      'ar'
    );
    expect(res.text).toBe('لديك {count, plural, one {# رسالة} other {# رسائل}}');
    expect(res.source).toBe('google');
    expect(suggestionRejectedForIcu()).toBe(false);
  });

  it('recurses into a nested select+plural block', async () => {
    const seen: string[] = [];
    routeMock(
      {
        'He has': 'لديه',
        'She has': 'لديها',
        'They have': 'لديهم',
        '# message': '# رسالة',
        '# messages': '# رسائل',
      },
      seen
    );
    const src =
      '{gender, select, male {He has {count, plural, one {# message} other {# messages}}} female {She has {count, plural, one {# message} other {# messages}}} other {They have {count, plural, one {# message} other {# messages}}}}';
    const res = await suggestTranslation(src, 'ar');
    expect(res.text).toBe(
      '{gender, select, male {لديه {count, plural, one {# رسالة} other {# رسائل}}} female {لديها {count, plural, one {# رسالة} other {# رسائل}}} other {لديهم {count, plural, one {# رسالة} other {# رسائل}}}}'
    );
    expect(res.source).toBe('google');
    expect(validatePlaceholders(src, res.text, 'ar').valid).toBe(true);
  });

  it('keeps a body whose translation would lose the #', async () => {
    routeMock(
      {
        'You have': 'لديك',
        '# message': 'رسالة',
        '# messages': '# رسائل',
      },
      []
    );
    const res = await suggestTranslation(
      'You have {count, plural, one {# message} other {# messages}}',
      'ar'
    );
    expect(res.text).toBe('لديك {count, plural, one {# message} other {# رسائل}}');
    expect(res.source).toBe('google');
  });

  it('returns a partial translation when only the surrounding text translates', async () => {
    routeMock({ 'liked your post': 'أعجبهم منشورك' }, []);
    const res = await suggestTranslation(SELECT, 'ar');
    expect(res.text).toBe('{gender, select, male {He} female {She} other {They}} أعجبهم منشورك');
    expect(res.source).toBe('google');
    expect(suggestionRejectedForIcu()).toBe(false);
  });

  it('falls back to heuristic when no piece translates', async () => {
    routeMock({}, []);
    const res = await suggestTranslation(SELECT, 'ar');
    expect(res.source).toBe('heuristic');
    expect(res.text).toBe(SELECT);
    expect(suggestionRejectedForIcu()).toBe(true);
  });
});

describe('AI providers still translate the whole string', () => {
  it('Gemini sees the original text and per-clause never runs', async () => {
    const seenGtx: string[] = [];
    saveCustomProviders([{ id: 'gemini-1', name: 'Gemini', type: 'gemini', apiKey: 'k' }]);
    setActiveProviderId('gemini-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('generativelanguage.googleapis.com')) {
          const body = JSON.parse(String(init?.body || '{}')) as {
            contents?: Array<{ parts?: Array<{ text?: string }> }>;
          };
          const prompt = body.contents?.[0]?.parts?.[0]?.text ?? '';
          // The model gets the original block, not the masked one.
          expect(prompt).toContain('{He}');
          expect(prompt).not.toContain('98710');
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: '{gender, select, male {هو} female {هي} other {هم}} أعجبهم منشورك',
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 }
          );
        }
        seenGtx.push(new URL(String(url)).searchParams.get('q') ?? '');
        return new Response(JSON.stringify([[[ '', '', null, null, 1]], null, 'en']), {
          status: 200,
        });
      })
    );
    const src = '{gender, select, male {He} female {She} other {They}} liked your post';
    const res = await suggestTranslation(src, 'ar');
    expect(res.text).toBe('{gender, select, male {هو} female {هي} other {هم}} أعجبهم منشورك');
    expect(res.source).toBe('gemini');
    // No machine-translation call at all: the whole-string AI reply succeeded.
    expect(seenGtx).toEqual([]);
  });
});
