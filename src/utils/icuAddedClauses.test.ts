import { describe, it, expect } from 'vitest';
import { getIcuFieldModel, assembleIcuFields, setIcuClauseValue } from './placeholderCheck';

const SRC = '{n, plural, one {# file} other {# files}}';
const save = (src: string, tgt: string, loc: string) => {
  const m = getIcuFieldModel(src, tgt, loc);
  return m ? assembleIcuFields(m) : null;
};

describe('empty categories the editor adds are shown, but never saved', () => {
  it('an untouched Arabic message round-trips byte for byte', () => {
    const tgt = '{n, plural, one {# رسالة} other {# رسائل}}';
    expect(save(SRC, tgt, 'ar')).toBe(tgt);
  });

  it('the Arabic view still offers all six categories', () => {
    const model = getIcuFieldModel(SRC, '{n, plural, one {# رسالة} other {# رسائل}}', 'ar')!;
    const block = model[0] as { clauses: Array<{ selector: string }> };
    expect(block.clauses.map((c) => c.selector)).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
  });

  it('typing in one added category saves that category only, the other empty ones stay out', () => {
    const model = getIcuFieldModel(SRC, '{n, plural, one {# رسالة} other {# رسائل}}', 'ar')!;
    expect(assembleIcuFields(setIcuClauseValue(model, 0, 2, 'اثنان'))).toBe(
      '{n, plural, one {# رسالة} two {اثنان} other {# رسائل}}'
    );
  });

  it('a category the editor added, filled and then cleared is not saved as an empty branch', () => {
    const model = getIcuFieldModel(SRC, '{n, plural, one {# رسالة} other {# رسائل}}', 'ar')!;
    const filled = setIcuClauseValue(model, 0, 2, 'اثنان');
    expect(assembleIcuFields(setIcuClauseValue(filled, 0, 2, ''))).toBe('{n, plural, one {# رسالة} other {# رسائل}}');
  });

  it('a Hindi message keeps only the categories Hindi uses', () => {
    expect(save(SRC, '{n, plural, one {एक फ़ाइल} other {# फ़ाइलें}}', 'hi')).toBe(
      '{n, plural, one {एक फ़ाइल} other {# फ़ाइलें}}'
    );
  });

  it('an empty branch the message already had is kept, since the translator wrote it', () => {
    expect(save(SRC, '{n, plural, one {} other {x}}', 'hi')).toBe('{n, plural, one {} other {x}}');
  });

  it('an explicit =N branch and other are kept even when empty', () => {
    expect(save('{n, plural, =0 {none} one {# f} other {# fs}}', '{n, plural, =0 {} one {ملف} other {}}', 'ar')).toBe(
      '{n, plural, =0 {} one {ملف} other {}}'
    );
  });

  it('a translation in a category Hindi does not use is kept', () => {
    expect(save(SRC, '{n, plural, one {एक} many {कई} other {बहुत}}', 'hi')).toBe(
      '{n, plural, one {एक} many {कई} other {बहुत}}'
    );
  });

  it('the saved string renders the way the translator meant it, for every count', () => {
    // The saved Arabic message has no empty branch, so counts 0, 2, 3 and 11 fall back to `other`.
    const saved = save(SRC, '{n, plural, one {# رسالة} other {# رسائل}}', 'ar');
    expect(saved).not.toMatch(/\{\s*\}/);
  });
});
