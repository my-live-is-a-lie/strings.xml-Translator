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


  it('keeps a separator between two blocks, and only a separator', () => {
    // A text run that carries no words is structure: keeping it is what stops two clauses from
    // being glued together. A run with words stays empty so English is never pre-filled.
    const source = '{a, plural, one {# file} other {# files}} · {b, select, m {He} other {They}}';
    const model = getIcuFieldModel(source, '')!;
    const middle = model[1];
    expect(middle).toMatchObject({ kind: 'text', value: ' · ' });
    const filled = setIcuClauseValue(
      setIcuClauseValue(
        setIcuClauseValue(setIcuClauseValue(model, 0, 0, '# ملف'), 0, 1, '# ملفات'),
        2,
        0,
        'هو'
      ),
      2,
      1,
      'هم'
    );
    expect(assembleIcuFields(filled)).toBe('{a, plural, one {# ملف} other {# ملفات}} · {b, select, m {هو} other {هم}}');

    // A run with words is not kept: the user writes it.
    const withWords = getIcuFieldModel('You have {n, plural, one {a} other {b}}', '')!;
    expect(withWords[0]).toMatchObject({ kind: 'text', value: '', sourceValue: 'You have ' });
  });

  it('keeps a punctuation-only prefix too, and still empties a real sentence', () => {
    const punct = getIcuFieldModel('({n, plural, one {a} other {b}})', '')!;
    expect(punct[0]).toMatchObject({ kind: 'text', value: '(' });
    expect(punct[2]).toMatchObject({ kind: 'text', value: ')' });
    const sentence = getIcuFieldModel('Note: {n, plural, one {a} other {b}}', '')!;
    expect(sentence[0]).toMatchObject({ kind: 'text', value: '' });
  });


  it('keeps a clause body that is only punctuation, and still empties one with words', () => {
    // `{-}` and `{…}` carry no words: leaving them empty lost the dash on save, and there is
    // nothing to translate in them. A body with words stays empty so English is never pre-filled.
    const punct = getIcuFieldModel('{n, plural, one {-} other {…}}', '')!;
    expect((punct[0] as IcuBlockField).clauses.map((c) => c.value)).toEqual(['-', '…']);
    expect((punct[0] as IcuBlockField).clauses.map((c) => c.sourceValue)).toEqual(['-', '…']);
    expect(assembleIcuFields(punct)).toBe('{n, plural, one {-} other {…}}');

    // A `#` alone is the ICU placeholder, never English: it is kept too.
    const hash = getIcuFieldModel('{n, plural, one {#} other {#}}', '')!;
    expect((hash[0] as IcuBlockField).clauses.map((c) => c.value)).toEqual(['#', '#']);

    const words = getIcuFieldModel('{n, plural, one {# message} other {# messages}}', '')!;
    expect((words[0] as IcuBlockField).clauses.map((c) => c.value)).toEqual(['', '']);

    // Mixed: the words are emptied, the dash is kept.
    const mixed = getIcuFieldModel('{g, select, male {He} other {—}}', '')!;
    expect((mixed[0] as IcuBlockField).clauses.map((c) => c.value)).toEqual(['', '—']);
  });

  it('sees a separator wrapped in bidi controls as structure, not as words', () => {
    // Arabic text copied from an app usually carries U+200F around its punctuation
    // (`'\u200f·\u200f'`). Those marks are category Cf, so a plain `\p{P}` test called the run
    // "text with words", left the field empty and the separator was lost on save.
    const source = '{a, plural, one {# file} other {# files}} \u200f·\u200f {b, select, m {He} other {They}}';
    const model = getIcuFieldModel(source, '')!;
    expect(model[1]).toMatchObject({ kind: 'text', value: ' \u200f·\u200f ' });
    expect(assembleIcuFields(model)).toBe('{a, plural, one {} other {}} \u200f·\u200f {b, select, m {} other {}}');
    // A run that still holds a word stays empty: the marks alone never qualify.
    const words = getIcuFieldModel('\u200fYou have\u200f {n, plural, one {a} other {b}}', '')!;
    expect(words[0]).toMatchObject({ kind: 'text', value: '' });
    // Same for a clause body: `{\u200f-\u200f}` is still a dash.
    const body = getIcuFieldModel('{n, plural, one {\u200f-\u200f} other {…}}', '')!;
    expect((body[0] as IcuBlockField).clauses.map((c) => c.value)).toEqual(['\u200f-\u200f', '…']);
  });

  it('puts a separator back when the target dropped it, and never glues two blocks together', () => {
    // A translation (or a pasted AI reply) that drops `' · '` between two blocks must not save
    // `{a…}{b…}`: the separator is structure, so the source's copy is restored. A run with
    // words stays empty — that one is the user's to write.
    const source = '{a, plural, one {# file} other {# files}} \u00b7 {b, select, m {He} other {They}}';
    const dropped = '{a, plural, one {# \u0645\u0644\u0641} other {# \u0645\u0644\u0641\u0627\u062a}}{b, select, m {\u0647\u0648} other {\u0647\u0645}}';
    const model = getIcuFieldModel(source, dropped)!;
    expect(model[1]).toMatchObject({ kind: 'text', value: ' \u00b7 ', sourceValue: ' \u00b7 ' });
    expect(assembleIcuFields(model)).toBe(
      '{a, plural, one {# \u0645\u0644\u0641} other {# \u0645\u0644\u0641\u0627\u062a}} \u00b7 {b, select, m {\u0647\u0648} other {\u0647\u0645}}'
    );

    // A dropped run with words is not invented for the user.
    const words = getIcuFieldModel('You have {n, plural, one {a} other {b}} now', '\u0644\u062f\u064a\u0643 {n, plural, one {a} other {b}}');
    expect(words).not.toBeNull();
    expect(words![0]).toMatchObject({ kind: 'text', value: '\u0644\u062f\u064a\u0643 ' });
    expect(words![2]).toMatchObject({ kind: 'text', value: '' });
  });

  it('editing one body only changes that body', () => {
    const t = '{g, select, male {He} female {She} other {They}} wrote';
    const model = getIcuFieldModel(t, t)!;
    const edited = setIcuClauseValue(model, 0, 1, 'هي');
    expect(assembleIcuFields(edited)).toBe('{g, select, male {He} female {هي} other {They}} wrote');
  });
});
