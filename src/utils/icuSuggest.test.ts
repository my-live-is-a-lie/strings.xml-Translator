import { describe, it, expect } from 'vitest';
import { fillAddedIcuClauses } from './icuSuggest';
import { getIcuFieldModel } from './placeholderCheck';

const SRC = '{count, plural, =0{No notifications} one{# notification} other{# notifications}}';
// What a suggestion returns today: only the clauses the source has.
const SUGGESTED = '{count, plural, =0{لا توجد إشعارات} one{# إشعار} other{# إشعارًا (إشعارات)}}';

describe('suggest fills the plural categories the target language adds', () => {
  it('reproduces the bug: the suggestion leaves zero, two, few and many empty', () => {
    const model = getIcuFieldModel(SRC, SUGGESTED, 'ar')!;
    const block = model[0] as { clauses: Array<{ selector: string; value: string; added?: boolean }> };
    const empty = block.clauses.filter((c) => !c.value.trim()).map((c) => c.selector);
    expect(empty).toEqual(['zero', 'two', 'few', 'many']);
  });

  it('fills every added category and keeps the suggested ones', async () => {
    const asked: string[] = [];
    const out = await fillAddedIcuClauses(SRC, SUGGESTED, 'ar', async (body, q) => {
      asked.push(`${q}:${body}`);
      return `[${q}] #`;
    });
    expect(asked.map((a) => a.split(':')[0])).toEqual(['zero', 'two', 'few', 'many']);
    const block = getIcuFieldModel(SRC, out, 'ar')![0] as { clauses: Array<{ selector: string; value: string }> };
    expect(block.clauses.every((c) => c.value.trim())).toBe(true);
    expect(block.clauses.find((c) => c.selector === 'one')!.value).toBe('# إشعار');
  });

  it('leaves a category empty when it cannot be translated', async () => {
    const out = await fillAddedIcuClauses(SRC, SUGGESTED, 'ar', async (_b, q) => (q === 'few' ? 'قليل #' : null));
    expect(out).toContain('few{قليل #}');
    expect(out).not.toContain('zero{');
  });

  it('does nothing for a language with the same categories as the source', async () => {
    const t = '{count, plural, one{# Datei} other{# Dateien}}';
    const out = await fillAddedIcuClauses('{count, plural, one{# file} other{# files}}', t, 'de', async () => 'x');
    expect(out).toBe(t);
  });
});
