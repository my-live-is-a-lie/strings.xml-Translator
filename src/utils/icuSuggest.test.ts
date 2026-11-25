import { describe, it, expect } from 'vitest';
import { emptyAddedIcuCategories, fillAddedIcuClauses } from './icuSuggest';
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

describe('emptyAddedIcuCategories', () => {
  const src = '{n, plural, one{# item} other{# items}}';
  it('lists added categories that are still empty', () => {
    expect(emptyAddedIcuCategories(src, '{n, plural, one{# عنصر} other{# عناصر}}', 'ar')).toEqual(['zero', 'two', 'few', 'many']);
  });
  it('lists a form left in English for a non-Latin target, and nothing when all is filled', () => {
    expect(emptyAddedIcuCategories(src, '{n, plural, zero{# ص} one{# عنصر} two{# ص} few{# ص} many{# ص} other{# items}}', 'ar')).toEqual(['other']);
    expect(emptyAddedIcuCategories(src, '{n, plural, zero{# ص} one{# عنصر} two{# ص} few{# ص} many{# ص} other{# عناصر}}', 'ar')).toEqual([]);
  });
  it('does not flag an unchanged form for a Latin-script target', () => {
    expect(emptyAddedIcuCategories(src, '{n, plural, one{# item} other{# items}}', 'de')).toEqual([]);
  });
});

describe('source with text around the block', () => {
  it('keeps the added categories a suggestion filled when the target has no outer whitespace', () => {
    const src = '\n        {count, plural,\n            =0 {No notifications}\n            one {# notification}\n            other {# notifications}\n        }\n    ';
    const target = '{count, plural,\n=0 {لا}\nzero {# أ}\none {# ب}\ntwo {# ج}\nfew {# د}\nmany {# هـ}\nother {# و}\n}';
    const model = getIcuFieldModel(src, target, 'ar')!;
    const block = model.find((f) => f.kind === 'block') as import('./placeholderCheck').IcuBlockField;
    expect(block.clauses.map((c) => c.selector + ':' + c.value)).toEqual(['=0:لا', 'zero:# أ', 'one:# ب', 'two:# ج', 'few:# د', 'many:# هـ', 'other:# و']);
    expect(emptyAddedIcuCategories(src, target, 'ar')).toEqual([]);
  });
});

describe('nested blocks', () => {
  it('fills the added categories of a plural inside a select clause', async () => {
    const src = '{g, select, male {{n, plural, one {He sent one} other {He sent #}}} other {{n, plural, one {They sent one} other {They sent #}}}}';
    const sug = '{g, select, male {{n, plural, one {أرسل واحدة} other {أرسل #}}} other {{n, plural, one {أرسلوا واحدة} other {أرسلوا #}}}}';
    const out = await fillAddedIcuClauses(src, sug, 'ar', async () => null, async (m) => m.replace(/\{(He|They) sent #\}/g, '{ب #}'));
    expect(emptyAddedIcuCategories(src, out, 'ar')).toEqual([]);
    expect(out).toContain('two {ب #}');
  });
});

describe('selectordinal', () => {
  it('drops English ordinal suffixes for an Arabic target without a request', async () => {
    const src = 'You finished {p, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}!';
    const sug = 'لقد أنهيت {p, selectordinal, one {#st} two {#nd} few {#ثالث} other {#th}}!';
    let calls = 0;
    const out = await fillAddedIcuClauses(src, sug, 'ar', async () => (calls++, null), async () => (calls++, null));
    expect(out).toBe('لقد أنهيت {p, selectordinal, one {#} two {#} few {#} other {#}}!');
    expect(calls).toBe(0);
    expect(emptyAddedIcuCategories(src, out, 'ar')).toEqual([]);
  });
});

describe('line breaks of a multi-line source', () => {
  it('adds the target categories without adding line breaks', async () => {
    const src = '\n        {count, plural,\n            =0 {No notifications}\n            one {# notification}\n            other {# notifications}\n        }\n    ';
    const sug = '{count, plural,\n            =0 {لا}\n            one {# ب}\n            other {# و}\n        }';
    const out = await fillAddedIcuClauses(src, sug, 'ar', async () => null, async () => '{n, plural, zero {# أ} two {# ج} few {# د} many {# هـ} other {# و}}');
    const count = (t: string) => (t.match(/\n/g) || []).length;
    expect(out).toContain('zero {# أ}');
    expect(count(out)).toBe(count(src));
  });
});
