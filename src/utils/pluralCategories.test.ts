import { describe, expect, it } from 'vitest';
import { getCldrPluralCategories } from './pluralCategories';
import { getPluralQuantitiesForLanguage, normalizePluralsForLanguage } from './xmlParser';
import { adaptIcuModelToLocale, assembleIcuFields, getIcuFieldModel } from './placeholderCheck';
import type { PluralStringItem } from '../types';

const AR_SOURCE = '{n, plural, zero {Z} one {O} two {T} few {F} many {M} other {X}}';
const EN_SOURCE = '{n, plural, one {# file} other {# files}}';
const cats = (m: ReturnType<typeof getIcuFieldModel>) =>
  (m!.find((f) => f.kind === 'block') as { clauses: { selector: string }[] }).clauses.map((c) => c.selector);

describe('plural categories follow the target language', () => {
  it('reads CLDR categories', () => {
    expect(getCldrPluralCategories('hi')).toEqual(['one', 'other']);
    expect(getCldrPluralCategories('ar')).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    expect(getCldrPluralCategories('fr')).toEqual(['one', 'many', 'other']);
    expect(getCldrPluralCategories('ja')).toEqual(['other']);
    expect(getCldrPluralCategories('pt-rBR')).toEqual(['one', 'many', 'other']);
    expect(getPluralQuantitiesForLanguage('pl')).toEqual(['one', 'few', 'many', 'other']);
  });

  it('ICU editor: empty target of an Arabic-shaped source gets Hindi categories', () => {
    expect(cats(getIcuFieldModel(AR_SOURCE, '', 'hi'))).toEqual(['one', 'other']);
  });

  it('ICU editor: English source gets Arabic categories only for Arabic', () => {
    expect(cats(getIcuFieldModel(EN_SOURCE, '', 'ar'))).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    expect(cats(getIcuFieldModel(EN_SOURCE, '', 'hi'))).toEqual(['one', 'other']);
  });

  it('keeps an existing translation under a category the language does not use', () => {
    const m = getIcuFieldModel(EN_SOURCE, '{n, plural, one {a} few {kept} other {b}}', 'hi');
    expect(cats(m)).toEqual(['one', 'few', 'other']);
  });

  it('keeps =N clauses and round-trips an already matching message', () => {
    const t = '{n, plural, =0 {none} one {a} other {b}}';
    const m = getIcuFieldModel(t, t, 'en')!;
    expect(assembleIcuFields(m)).toBe(t);
    expect(cats(m)).toEqual(['=0', 'one', 'other']);
  });

  it('produces valid assembled text with added categories', () => {
    const m = adaptIcuModelToLocale(getIcuFieldModel(EN_SOURCE, '')!, 'ar');
    expect(assembleIcuFields(m)).toBe('{n, plural, zero {} one {} two {} few {} many {} other {}}');
  });

  it('adapts a plural nested in a select', () => {
    const src = '{g, select, male {{n, plural, one {a} other {b}}} other {x}}';
    const out = assembleIcuFields(getIcuFieldModel(src, '', 'ar')!);
    expect(out).toContain('zero {}');
    expect(out).toContain('many {}');
  });

  it('Android plurals: Hindi gets one/other, stale empty Arabic forms are dropped, typed ones stay', () => {
    const item: PluralStringItem = {
      id: 'p', type: 'plural', name: 'p', status: 'untranslated', translatable: true,
      items: [
        { quantity: 'zero', source: 'z', target: '' },
        { quantity: 'one', source: 'o', target: '' },
        { quantity: 'few', source: 'f', target: 'kept' },
        { quantity: 'other', source: 'x', target: '' },
      ],
    } as unknown as PluralStringItem;
    const out = normalizePluralsForLanguage([item], 'hi')[0] as PluralStringItem;
    expect(out.items.map((i) => i.quantity)).toEqual(['one', 'few', 'other']);
  });
});
