import { describe, expect, it } from 'vitest';
import {
  assembleIcuFields,
  getIcuFieldModel,
  setIcuClauseValue,
  setIcuTextValue,
  validatePlaceholders,
  type IcuBlockField,
} from './placeholderCheck';

const roundTrip = (source: string, target: string): string => {
  const model = getIcuFieldModel(source, target);
  expect(model).not.toBeNull();
  return assembleIcuFields(model!);
};

const firstBlock = (source: string, target: string): IcuBlockField => {
  const model = getIcuFieldModel(source, target);
  const block = model?.find((f): f is IcuBlockField => f.kind === 'block');
  expect(block).toBeDefined();
  return block!;
};

describe('getIcuFieldModel / assembleIcuFields', () => {
  it('round-trips a select byte for byte', () => {
    const t = '{gender, select, male {He liked it} female {She liked it} other {They liked it}} your post';
    expect(roundTrip(t, t)).toBe(t);
    const block = firstBlock(t, t);
    expect(block.name).toBe('gender');
    expect(block.type).toBe('select');
    expect(block.clauses.map((c) => [c.selector, c.value])).toEqual([
      ['male', 'He liked it'],
      ['female', 'She liked it'],
      ['other', 'They liked it'],
    ]);
  });

  it('round-trips a plural with offset: and exposes it as a label', () => {
    const t = '{n, plural, offset:1 =0 {Nobody} =1 {You} other {You and # others}}';
    expect(roundTrip(t, t)).toBe(t);
    const block = firstBlock(t, t);
    expect(block.offset).toBe('1');
    expect(block.clauses.map((c) => c.selector)).toEqual(['=0', '=1', 'other']);
    expect(block.clauses[2].value).toBe('You and # others');
  });

  it('keeps a nested block opaque inside the outer clause body', () => {
    const t = '{g, select, male {{n, plural, one {# boy} other {# boys}}} other {People}}';
    expect(roundTrip(t, t)).toBe(t);
    const block = firstBlock(t, t);
    expect(block.clauses).toHaveLength(2);
    expect(block.clauses[0].value).toBe('{n, plural, one {# boy} other {# boys}}');
  });

  it('keeps a quoted literal inside the body value', () => {
    const t = "{g, select, male {Say '{He}' now} other {Hi}}";
    expect(roundTrip(t, t)).toBe(t);
    expect(firstBlock(t, t).clauses[0].value).toBe("Say '{He}' now");
  });

  it('round-trips double spaces around a block and odd whitespace in the frame', () => {
    const t = 'You  have  {n, plural,  one {# msg}   other {# msgs} }  total';
    expect(roundTrip(t, t)).toBe(t);
    const model = getIcuFieldModel(t, t)!;
    expect(model.map((f) => f.kind)).toEqual(['text', 'block', 'text']);
  });

  it('derives an empty target from the source structure with empty bodies', () => {
    const source = 'You have {count, plural, one {# message} other {# messages}}';
    const model = getIcuFieldModel(source, '')!;
    const block = model.find((f): f is IcuBlockField => f.kind === 'block')!;
    expect(block.clauses.map((c) => c.value)).toEqual(['', '']);
    expect(block.clauses.map((c) => c.sourceValue)).toEqual(['# message', '# messages']);
    // The leading text run starts empty and keeps the source as its reference.
    expect(model[0]).toMatchObject({ kind: 'text', value: '', sourceValue: 'You have ' });
    // A body typed into the empty model reassembles into a valid block.
    const filled = setIcuClauseValue(setIcuTextValue(model, 0, 'لديك '), 1, 0, '# رسالة');
    expect(assembleIcuFields(setIcuClauseValue(filled, 1, 1, '# رسائل'))).toBe(
      'لديك {count, plural, one {# رسالة} other {# رسائل}}'
    );
  });

  it('returns null for a broken or block-less target', () => {
    const source = '{n, plural, one {# a} other {# b}}';
    expect(getIcuFieldModel(source, 'plain text, no block')).toBeNull();
    expect(getIcuFieldModel(source, '{n, plural, one {# a} other {# b}')).toBeNull();
    expect(getIcuFieldModel(source, '{n, plural, one {# a} other {# b}} }')).toBeNull();
    // A source without a block gives no model either, even for an empty target.
    expect(getIcuFieldModel('Hello', '')).toBeNull();
  });

  it('takes the model from the target when it adds plural categories (Arabic)', () => {
    const source = '{n, plural, one {# book} other {# books}}';
    const target = '{n, plural, zero {لا كتب} one {كتاب} two {كتابان} few {# كتب} many {# كتابًا} other {# كتاب}}';
    const block = firstBlock(source, target);
    expect(block.clauses.map((c) => c.selector)).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    // Categories the source lacks fall back to its `other` body as the reference.
    expect(block.clauses[0].sourceValue).toBe('# books');
    expect(block.clauses[1].sourceValue).toBe('# book');
    expect(assembleIcuFields(getIcuFieldModel(source, target)!)).toBe(target);
  });


  it('keeps the fields view alive when a brace is typed into a body', () => {
    // The fields view promises the structure cannot be broken by typing. Before the editor
    // stripped braces, a stray `}` reassembled into `one {# رسالة}} other {}}`: the model no
    // longer parsed (the fields view vanished mid-edit) and the hard save gate refused the
    // string, so the user could not tell what happened or how to get back.
    const source = '{n, plural, one {# message} other {# messages}}';
    const model = getIcuFieldModel(source, '')!;
    const withTypedBrace = setIcuClauseValue(model, 0, 0, '# رسالة}');
    expect(assembleIcuFields(withTypedBrace)).toContain('one {# رسالة}}');
    expect(getIcuFieldModel(source, assembleIcuFields(withTypedBrace))).toBeNull();
    // The editor strips the brace before rebuilding, so the model always stays parsable.
    const stripped = setIcuClauseValue(model, 0, 0, '# رسالة}'.replace(/[{}]/g, ''));
    const assembled = assembleIcuFields(stripped);
    expect(getIcuFieldModel(source, assembled)).not.toBeNull();
    // The structure is intact (`#` still present, no unbalanced brace); the string is invalid
    // only because this test leaves the `other` body empty on purpose.
    expect(validatePlaceholders(source, assembled, 'ar').missingInTarget).not.toContain('{n,plural}');
  });

  it('accepts a literal brace written with ICU quoting (the Raw view escapes them)', () => {
    // `'{'` is how ICU writes a literal brace; the field keeps the quotes, so nothing is lost.
    const t = "{g, select, male {Use '{' here} other {No}}";
    expect(roundTrip(t, t)).toBe(t);
  });


  it('keeps the text runs the target does not have yet', () => {
    // The fields view is derived from the target once it holds a block. Typing in ONE field of
    // an otherwise empty string used to produce a target with a single text run, so the other
    // runs vanished: their text could never be filled in, and the string saved without it.
    // ("You have {…} in your inbox" lost " in your inbox" after one keystroke.)
    const source = 'You have {count, plural, one {# message} other {# messages}} in your inbox';
    const empty = getIcuFieldModel(source, '')!;
    expect(empty.filter((f) => f.kind === 'text')).toHaveLength(2);

    // After the user types in the FIRST run only, the trailing run must still be there.
    const partial = assembleIcuFields(setIcuTextValue(empty, 0, 'لديك '));
    expect(partial).toBe('لديك {count, plural, one {} other {}}');
    const model = getIcuFieldModel(source, partial)!;
    expect(model.filter((f) => f.kind === 'text')).toHaveLength(2);
    expect(assembleIcuFields(model)).toBe(partial);

    // Filling it in rebuilds the whole string, with the target's own text kept.
    const filled = setIcuTextValue(
      setIcuClauseValue(setIcuClauseValue(setIcuTextValue(model, 0, 'لديك '), 1, 0, '# رسالة'), 1, 1, '# رسائل'),
      2,
      ' في بريدك'
    );
    expect(assembleIcuFields(filled)).toBe('لديك {count, plural, one {# رسالة} other {# رسائل}} في بريدك');
  });

  it('keeps a trailing run in place when only it was typed', () => {
    // The overlay matches runs by the segment they sit in (before/after each block), not by
    // position among all runs: a purely positional overlay assigned the target's only run to
    // the source's FIRST run, so text typed in the trailing field silently moved to the front
    // of the string on the next keystroke.
    const source = 'You have {count, plural, one {# message} other {# messages}} in your inbox';
    const empty = getIcuFieldModel(source, '')!;
    const partial = assembleIcuFields(setIcuTextValue(empty, 2, ' في بريدك'));
    expect(partial).toBe('{count, plural, one {} other {}} في بريدك');
    const model = getIcuFieldModel(source, partial)!;
    expect(model.filter((f) => f.kind === 'text')).toHaveLength(2);
    expect(model[0]).toMatchObject({ kind: 'text', value: '' });
    expect(model[2]).toMatchObject({ kind: 'text', value: ' في بريدك' });
    expect(assembleIcuFields(model)).toBe(partial);
  });

  it('still returns null once the block itself does not parse', () => {
    // The text-run repair must never hide a damaged block behind a fields view.
    const source = 'You have {count, plural, one {# message} other {# messages}} after';
    const broken = 'لديك {count, plural, one {# رسالة} after';
    expect(getIcuFieldModel(source, broken)).toBeNull();
  });

  it('editing one body only changes that body', () => {
    const t = '{g, select, male {He} female {She} other {They}} wrote';
    const model = getIcuFieldModel(t, t)!;
    const edited = setIcuClauseValue(model, 0, 1, 'هي');
    expect(assembleIcuFields(edited)).toBe('{g, select, male {He} female {هي} other {They}} wrote');
  });
});
