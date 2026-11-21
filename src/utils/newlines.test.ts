import { describe, it, expect } from 'vitest';
import {
  toEditorText,
  toStoredText,
  normalizeTypedBreaks,
  countLineBreaks,
  lineBreakDifference,
  toEditorItem,
  toStoredItem,
  hasMidLineDoubleSpaces,
  collapseMidLineDoubleSpaces,
  splitFormattingEdges,
  sourceFormattingEdges,
  restoreFormattingEdges,
  splitInteriorIndents,
  restoreInteriorIndents,
  mergeFormattingIndents,
} from './newlines';
import type { ResourceItem } from '../types';

describe('line breaks', () => {
  it('shows each \\n as a real line break and back', () => {
    expect(toEditorText('a\\nb\\n\\nc')).toBe('a\nb\n\nc');
    expect(toStoredText('a\nb\n\nc')).toBe('a\\nb\\n\\nc');
    expect(toStoredText(toEditorText('x\\n\\ny'))).toBe('x\\n\\ny');
  });

  it('leaves an escaped backslash + n alone', () => {
    const s = 'What:\\\\nRequest:\\\\nOS:';
    expect(toEditorText(s)).toBe(s);
    expect(countLineBreaks(s)).toBe(0);
    expect(toEditorText('a\\\\n\\nb')).toBe('a\\\\n\nb');
  });

  it('ignores the formatting break that precedes a \\n in the raw XML', () => {
    const raw = 'Import:\n\\n\n\\n1. Go\n\\n2. Log in';
    expect(toEditorText(raw)).toBe('Import:\n\n1. Go\n2. Log in');
    expect(countLineBreaks(raw)).toBe(3);
  });

  it('counts breaks in either form and reports what is missing or extra', () => {
    expect(countLineBreaks('one\\ntwo\\n\\nthree')).toBe(3);
    expect(countLineBreaks('one\ntwo\n\nthree')).toBe(3);
    expect(lineBreakDifference('a\\nb\\nc', 'x\ny')).toBe(1);
    expect(lineBreakDifference('a\\nb', 'x\ny\nz\nw')).toBe(-2);
    expect(lineBreakDifference('a\\nb', 'x\ny')).toBe(0);
  });

  it('turns a hand-typed \\n into a break and keeps the caret in place', () => {
    expect(normalizeTypedBreaks('hello\\n', 7)).toEqual({ text: 'hello\n', caret: 6 });
    expect(normalizeTypedBreaks('ab\\ncd', 4)).toEqual({ text: 'ab\ncd', caret: 3 });
    expect(normalizeTypedBreaks('plain', 3)).toEqual({ text: 'plain', caret: 3 });
    // the person's own break before a hand-typed \n is kept (only loading stored text drops formatting breaks)
    expect(normalizeTypedBreaks('abc\n\n\\n', 8)).toEqual({ text: 'abc\n\n\n', caret: 6 });
  });

  it('converts the targets of every item type', () => {
    const str = { type: 'string', id: '1', name: 'a', source: 's\\nt', target: 'x\\ny', status: 'translated' } as unknown as ResourceItem;
    const plural = { type: 'plural', id: '2', name: 'p', status: 'translated', items: [{ quantity: 'one', source: 'a\\nb', target: 'c\\nd' }] } as unknown as ResourceItem;
    expect((toEditorItem(str) as { target: string }).target).toBe('x\ny');
    expect((toStoredItem(toEditorItem(str)) as { target: string }).target).toBe('x\\ny');
    expect((toEditorItem(plural) as { items: { target: string; source: string }[] }).items[0].target).toBe('c\nd');
    expect((toEditorItem(plural) as { items: { source: string }[] }).items[0].source).toBe('a\\nb'); // sources are never changed
  });
});

describe('mid-line double spaces', () => {
  it('ignores start-of-line indentation copied from the raw XML', () => {
    const indented = '\n        {count, plural,\n            one {# msg}\n            other {# msgs}\n        }\n    ';
    expect(hasMidLineDoubleSpaces(indented)).toBe(false);
    expect(collapseMidLineDoubleSpaces(indented)).toBe(indented);
  });

  it('flags and fixes a real double space in the middle of a line', () => {
    const typo = 'Hello  world';
    expect(hasMidLineDoubleSpaces(typo)).toBe(true);
    expect(collapseMidLineDoubleSpaces(typo)).toBe('Hello world');
  });

  it('flags a mid-line double space even alongside clean indentation', () => {
    const mixed = '\n    Hello  world\n    second  line\n    ';
    expect(hasMidLineDoubleSpaces(mixed)).toBe(true);
    expect(collapseMidLineDoubleSpaces(mixed)).toBe('\n    Hello world\n    second line\n    ');
  });

  it('leaves a double space right at the very start of the text alone', () => {
    const leading = '  Hello world';
    expect(hasMidLineDoubleSpaces(leading)).toBe(false);
    expect(collapseMidLineDoubleSpaces(leading)).toBe(leading);
  });

  it('accepts stored form (literal \\n) the same way as editor form', () => {
    expect(hasMidLineDoubleSpaces('line one\\n    line  two')).toBe(true);
    expect(hasMidLineDoubleSpaces('line one\\n    indented only')).toBe(false);
  });

  it('collapses stored-form input correctly instead of treating its literal \\n as plain characters', () => {
    expect(collapseMidLineDoubleSpaces('line one\\n    line  two')).toBe('line one\n    line two');
    expect(collapseMidLineDoubleSpaces('line one\\n    indented only')).toBe('line one\n    indented only');
  });
});

describe('formatting edges', () => {
  const prettySource = '\n        Price: {amount, number, ::currency/USD}\n    ';

  it('splits the raw-XML formatting whitespace off a pretty-printed target and restores it', () => {
    const target = '\n        السعر: {amount, number, ::currency/USD}\n    ';
    const { core, edges } = splitFormattingEdges(prettySource, target);
    expect(core).toBe('السعر: {amount, number, ::currency/USD}');
    expect(edges).toEqual({ leading: '\n        ', trailing: '\n    ' });
    expect(restoreFormattingEdges(core, edges)).toBe(target);
    // the stored form round-trips exactly as before the split
    expect(toStoredText(restoreFormattingEdges(core, edges))).toBe(toStoredText(target));
  });

  it('hides only the end whose source has a formatting run too', () => {
    // source pretty-printed, target only has the leading formatting run
    expect(splitFormattingEdges(prettySource, '\n        السعر: x').edges).toEqual({
      leading: '\n        ',
      trailing: '',
    });
    // source inline: the same target run is the translator's own layout, kept visible
    expect(splitFormattingEdges('Price: x', '\n        السعر: x').edges).toBeNull();
  });

  it('keeps a real leading/trailing space visible: no line break, not formatting', () => {
    expect(splitFormattingEdges(' text', ' نص').edges).toBeNull();
    expect(splitFormattingEdges(prettySource, ' نص').edges).toBeNull();
    expect(splitFormattingEdges(prettySource, ' نص ').edges).toBeNull();
  });

  it('treats an all-whitespace target as a single run', () => {
    const { core, edges } = splitFormattingEdges(prettySource, '\n    ');
    expect(core).toBe('');
    expect(edges).toEqual({ leading: '\n    ', trailing: '' });
    // ...and without a line break it is content, not formatting
    expect(splitFormattingEdges(prettySource, '    ').edges).toBeNull();
  });

  it('borrows the source formatting edges for a target that has none', () => {
    expect(sourceFormattingEdges(prettySource)).toEqual({ leading: '\n        ', trailing: '\n    ' });
    expect(sourceFormattingEdges('Price: x')).toBeNull();
    expect(sourceFormattingEdges('\n        Price: x')).toEqual({ leading: '\n        ', trailing: '' });
    const borrowed = sourceFormattingEdges(prettySource);
    expect(restoreFormattingEdges('السعر: x', borrowed)).toBe('\n        السعر: x\n    ');
  });

  it('never doubles an end that already has a line-break run', () => {
    const edges = { leading: '\n        ', trailing: '\n    ' };
    expect(restoreFormattingEdges('\n  نص', edges)).toBe('\n  نص\n    ');
    expect(restoreFormattingEdges('نص\n  ', edges)).toBe('\n        نص\n  ');
    expect(restoreFormattingEdges('\n  نص\n  ', edges)).toBe('\n  نص\n  ');
  });

  it('leaves an empty target empty: an untranslated string stays untranslated', () => {
    const edges = { leading: '\n        ', trailing: '\n    ' };
    expect(restoreFormattingEdges('', edges)).toBe('');
    expect(restoreFormattingEdges('   ', edges)).toBe('   ');
    expect(restoreFormattingEdges('نص', null)).toBe('نص');
  });

  it('a literal \\n in the source is content, never a formatting edge', () => {
    const { edges } = splitFormattingEdges('\\n        Price: x', '\n        السعر: x');
    expect(edges).toBeNull();
  });
});

describe('interior pretty-print indentation', () => {
  // a pretty-printed ICU plural: edges split off first, then the interior line starts
  const sourceCore = '{minutes, plural,\n            =0 {Less than a minute}\n            one {# minute}\n            other {# minutes}\n        } ago';
  const targetCore = '{minutes, plural,\n            =0 {أقل من دقيقة}\n            one {# دقيقة}\n            other {# دقائق}\n        } منذ قليل';
  const dedented = '{minutes, plural,\n=0 {أقل من دقيقة}\none {# دقيقة}\nother {# دقائق}\n} منذ قليل';

  it('strips the source-matched line-start runs and restores them byte-identically', () => {
    const { display, indents } = splitInteriorIndents(sourceCore, targetCore);
    expect(display).toBe(dedented);
    expect(indents).toEqual({
      lines: [null, '            ', '            ', '            ', '        '],
    });
    expect(restoreInteriorIndents(display, indents)).toBe(targetCore);
  });

  it('keeps a line-start run the source does not have: it is content', () => {
    const noIndentSource = '{a, plural,\nother {x}\n} end';
    const { display, indents } = splitInteriorIndents(noIndentSource, '{a, plural,\n    other {x}\n} end');
    expect(indents).toBeNull();
    expect(display).toBe('{a, plural,\n    other {x}\n} end');
  });

  it('keeps real text on a line: only the leading run is hidden', () => {
    const { display } = splitInteriorIndents(sourceCore, targetCore);
    expect(display.split('\n')[4]).toBe('} منذ قليل');
  });

  it('never doubles a line that already starts with its hidden run', () => {
    const indents = { lines: [null, '            ', null] };
    expect(restoreInteriorIndents('a\n            kept\nb', indents)).toBe('a\n            kept\nb');
    expect(restoreInteriorIndents('a\n  short\nb', indents)).toBe('a\n              short\nb');
  });

  it('leaves an empty or single-line target alone', () => {
    expect(splitInteriorIndents(sourceCore, '').indents).toBeNull();
    expect(splitInteriorIndents(sourceCore, 'one line').indents).toBeNull();
    expect(restoreInteriorIndents('', { lines: ['  '] })).toBe('');
    expect(restoreInteriorIndents('نص', null)).toBe('نص');
  });

  it('reads the source pattern alone for a fresh translation (source as its own target)', () => {
    const { indents } = splitInteriorIndents(sourceCore, sourceCore);
    const typed = '{minutes, plural,\n=0 {س}\none {# س}\nother {# س}\n} منذ';
    expect(restoreInteriorIndents(typed, indents)).toBe(
      '{minutes, plural,\n            =0 {س}\n            one {# س}\n            other {# س}\n        } منذ'
    );
  });

  it('merge: the kept original run wins its slot over arriving whitespace', () => {
    const kept = { lines: [null, '            ', '        '] };
    const arriving = { lines: [null, '  ', '  '] };
    expect(mergeFormattingIndents(kept, arriving)).toEqual(kept);
    // a slot the original does not have takes the arriving run (suggestion/paste with source layout)
    expect(mergeFormattingIndents({ lines: [null, null] }, { lines: [null, '    '] })).toEqual({
      lines: [null, '    '],
    });
    expect(mergeFormattingIndents(null, arriving)).toEqual(arriving);
    expect(mergeFormattingIndents(kept, null)).toEqual(kept);
  });
});
