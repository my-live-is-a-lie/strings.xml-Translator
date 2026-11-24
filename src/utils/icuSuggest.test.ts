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

  it('keeps the suggestion and the other categories when one request throws', async () => {
    const out = await fillAddedIcuClauses(SRC, SUGGESTED, 'ar', async (_b, q) => {
      if (q === 'two') throw new Error('network');
      return `[${q}] #`;
    });
    expect(out).toContain('few{[few] #}');
    expect(out).toContain('many{[many] #}');
    expect(out).not.toContain('two{');
    expect(out).toContain('# إشعار');
  });

  describe('one combined request instead of one per category', () => {
    // What an AI provider returns for the combined message: it may also add the `one` category.
    const reply = (m: string) => {
      expect(m).toBe('{n, plural, zero {# notifications} two {# notifications} few {# notifications} many {# notifications} other {# notifications}}');
      return '{n, plural, zero {لا إشعارات} one {# إشعار} two {إشعاران} few {# إشعارات} many {# إشعارًا} other {# إشعار}}';
    };

    it('sends one request for all added categories and reads each clause', async () => {
      const src = '{count, plural, one{# notification} other{# notifications}}';
      const sug = '{count, plural, one{# إشعار} other{# إشعار}}';
      let messages = 0;
      let bodies = 0;
      const out = await fillAddedIcuClauses(
        src,
        sug,
        'ar',
        async () => {
          bodies++;
          return null;
        },
        async (m) => {
          messages++;
          return reply(m);
        }
      );
      expect(messages).toBe(1);
      expect(bodies).toBe(0);
      expect(out).toContain('zero{لا إشعارات}');
      expect(out).toContain('two{إشعاران}');
      expect(out).toContain('few{# إشعارات}');
      expect(out).toContain('many{# إشعارًا}');
      // the suggested categories are not overwritten by the combined reply
      expect(out).toContain('one{# إشعار}');
    });

    it('asks per category only for the ones the combined reply left out', async () => {
      const src = '{count, plural, one{# notification} other{# notifications}}';
      const sug = '{count, plural, one{# إشعار} other{# إشعار}}';
      const asked: string[] = [];
      const out = await fillAddedIcuClauses(
        src,
        sug,
        'ar',
        async (_b, q) => {
          asked.push(q);
          return `[${q}]`;
        },
        async () => '{n, plural, zero {صفر} two {اثنان} other {x}}'
      );
      expect(asked).toEqual(['few', 'many']);
      expect(out).toContain('zero{صفر}');
      expect(out).toContain('few{[few]}');
    });

    it('sends nothing more when the combined request fails (no extra spend on a limited API)', async () => {
      const src = '{count, plural, one{# notification} other{# notifications}}';
      const sug = '{count, plural, one{# إشعار} other{# إشعار}}';
      for (const combined of [
        async () => {
          throw new Error('rate limit');
        },
        async () => null,
        async () => 'not an ICU message',
      ]) {
        let asked = 0;
        const out = await fillAddedIcuClauses(src, sug, 'ar', async () => (asked++, 'x'), combined);
        expect(asked).toBe(0);
        expect(out).toBe(sug);
      }
    });

    it('uses the free Arabic glossary first and sends only the forms it does not cover', async () => {
      const src = '{count, plural, one{You have %d unread notification} other{You have %d unread notifications}}';
      const sug = '{count, plural, one{لديك إشعار} other{لديك إشعارات}}';
      let requests = 0;
      const out = await fillAddedIcuClauses(src, sug, 'ar', async () => (requests++, 'x'), async () => (requests++, null));
      // every added form of this body is in the glossary: no request at all
      expect(requests).toBe(0);
      expect(out).toContain('zero{ليس لديك أي إشعارات غير مقروءة}');
      expect(out).toContain('many{لديك %d إشعارًا غير مقروء}');

      // a body the glossary lacks still goes out as one combined request
      let messages = 0;
      await fillAddedIcuClauses(
        '{count, plural, one{# file} other{# files}}',
        '{count, plural, one{# ملف} other{# ملفات}}',
        'ar',
        async () => 'x',
        async () => (messages++, null)
      );
      expect(messages).toBe(1);
    });

    it('keeps a placeholder body together and does not call the combined request for a single missing category', async () => {
      const src = '{count, plural, one{{name} liked this} other{{name} and # others liked this}}';
      const sug = '{count, plural, one{أعجب {name}} other{أعجب {name} و# آخرين}}';
      const seen: string[] = [];
      await fillAddedIcuClauses(src, sug, 'ar', async () => 'x', async (m) => (seen.push(m), null));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain('zero {{name} and # others liked this}');
      const one = await fillAddedIcuClauses(
        '{n, plural, one{# a} other{# b}}',
        '{n, plural, one{# أ} other{# ب}}',
        'fr',
        async () => 'x',
        async () => {
          throw new Error('should not be called');
        }
      );
      expect(typeof one).toBe('string');
    });
  });
});
