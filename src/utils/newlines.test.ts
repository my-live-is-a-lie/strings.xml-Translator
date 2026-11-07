import { describe, it, expect } from 'vitest';
import { toEditorText, toStoredText, normalizeTypedBreaks, countLineBreaks, lineBreakDifference, toEditorItem, toStoredItem } from './newlines';
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
