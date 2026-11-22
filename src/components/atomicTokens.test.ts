// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import {
  findAtomicTokens,
  handleAtomicTokenKeyDown,
  PRINTF_TOKEN_SOURCE,
  ICU_VAR_TOKEN_SOURCE,
} from './highlightedTextareaHelpers';

const re = new RegExp(`(?:${PRINTF_TOKEN_SOURCE}|${ICU_VAR_TOKEN_SOURCE})`, 'g');
const hashRe = new RegExp(`(?:${PRINTF_TOKEN_SOURCE}|${ICU_VAR_TOKEN_SOURCE}|#)`, 'g');

const press = (ta: HTMLTextAreaElement, key: string) => {
  const e = {
    currentTarget: ta,
    key,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
  return handleAtomicTokenKeyDown(e, tokenReFor(ta)) ? e : null;
};
// helper so tests can pick which regex a textarea "uses"
const hashSet = new WeakSet<HTMLTextAreaElement>();
const tokenReFor = (ta: HTMLTextAreaElement) => (hashSet.has(ta) ? hashRe : re);

const makeTa = (value: string, pos: number, end = pos, withHash = false) => {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setSelectionRange(pos, end);
  if (withHash) hashSet.add(ta);
  document.body.appendChild(ta);
  return ta;
};

describe('findAtomicTokens', () => {
  it('finds printf specifiers and ICU variables', () => {
    expect(findAtomicTokens('لديك %1$s و %2$d من {count}', re)).toEqual([
      [5, 9],
      [12, 16],
      [20, 27],
    ]);
    expect(findAtomicTokens('%.2f and %s and 100%', re)).toEqual([
      [0, 4],
      [9, 11],
    ]);
  });
  it('finds full single-level ICU arguments', () => {
    expect(findAtomicTokens('في {date, date, medium} و {count, number}', re)).toEqual([
      [3, 23],
      [26, 41],
    ]);
  });
  it('finds arguments with style keywords and skeletons', () => {
    expect(findAtomicTokens('Downloaded {progress, number, percent}', re)).toEqual([[11, 38]]);
    expect(findAtomicTokens('السعر {amount, number, ::currency/USD} الآن', re)).toEqual([
      [6, 38],
    ]);
    expect(findAtomicTokens('{0} files in {1} folders', re)).toEqual([
      [0, 3],
      [13, 16],
    ]);
  });
  it('does not chip a block with nested clauses (only simple refs inside it)', () => {
    // The {count, plural, ...} block itself must not match: its body stays editable structure.
    // The simple refs inside the clause bodies do match, which is fine.
    const tokens = findAtomicTokens('{count, plural, one {x} other {y}}', re);
    expect(tokens).toEqual([
      [20, 23],
      [30, 33],
    ]);
    expect(tokens.some(([a, b]) => b - a > 20)).toBe(false);
  });
  it('finds a bare # only with the hash pattern', () => {
    expect(findAtomicTokens('عدد # هنا', re)).toEqual([]);
    expect(findAtomicTokens('عدد # هنا', hashRe)).toEqual([[4, 5]]);
  });
});

describe('atomic delete', () => {
  it('Backspace right after a token removes the whole token', () => {
    const ta = makeTa('ابحث عن %1$s الآن', 12);
    const e = press(ta, 'Backspace');
    expect(e?.preventDefault).toHaveBeenCalled();
    expect(ta.value).toBe('ابحث عن  الآن');
    expect(ta.selectionStart).toBe(8);
  });

  it('Backspace inside a token removes the whole token', () => {
    const ta = makeTa('ابحث عن %1$s الآن', 11);
    const e = press(ta, 'Backspace');
    expect(e?.preventDefault).toHaveBeenCalled();
    expect(ta.value).toBe('ابحث عن  الآن');
  });

  it('Delete right before a token removes the whole token', () => {
    const ta = makeTa('ابحث عن %1$s الآن', 8);
    const e = press(ta, 'Delete');
    expect(e?.preventDefault).toHaveBeenCalled();
    expect(ta.value).toBe('ابحث عن  الآن');
    expect(ta.selectionStart).toBe(8);
  });

  it('Backspace after normal text behaves normally (not handled)', () => {
    const ta = makeTa('ابحث عن %1$s الآن', 16);
    expect(press(ta, 'Backspace')).toBeNull();
    expect(ta.value).toBe('ابحث عن %1$s الآن');
  });

  it('a selection overlapping a token expands to the whole token', () => {
    const ta = makeTa('ابحث عن %1$s الآن', 11, 15);
    const e = press(ta, 'Backspace');
    expect(e?.preventDefault).toHaveBeenCalled();
    expect(ta.value).toBe('ابحث عن آن');
  });

  it('a # deletes atomically in plural fields', () => {
    const ta = makeTa('عدد # عناصر', 5, 5, true);
    const e = press(ta, 'Backspace');
    expect(e?.preventDefault).toHaveBeenCalled();
    expect(ta.value).toBe('عدد  عناصر');
  });
});

describe('typing inside a token', () => {
  it('snaps the caret past the token and inserts there', () => {
    const inserted: string[] = [];
    const original = document.execCommand;
    document.execCommand = vi.fn((cmd: string, _ui?: boolean, arg?: string) => {
      inserted.push(arg ?? '');
      return true;
    }) as typeof document.execCommand;
    const ta = makeTa('ابحث عن %1$s الآن', 11);
    const e = press(ta, 'x');
    expect(e?.preventDefault).toHaveBeenCalled();
    expect(inserted).toEqual(['x']);
    document.execCommand = original;
  });
});

import { hasUnterminatedIcuQuote } from '../utils/placeholderCheck';

describe('hasUnterminatedIcuQuote', () => {
  it('accepts balanced ICU quoting', () => {
    expect(hasUnterminatedIcuQuote("'{username}' said: ''Hello!''")).toBe(false);
  });
  it('flags a deleted closing quote', () => {
    expect(hasUnterminatedIcuQuote("'{username} said: ''Hello!''")).toBe(true);
  });
  it('flags a lone opening quote', () => {
    expect(hasUnterminatedIcuQuote("'{username}")).toBe(true);
  });
  it('ignores literal apostrophes', () => {
    expect(hasUnterminatedIcuQuote("it's fine and ''quoted''")).toBe(false);
    expect(hasUnterminatedIcuQuote("لا توجد علامات")).toBe(false);
  });
  it('keeps quoting through a doubled apostrophe inside the quote', () => {
    expect(hasUnterminatedIcuQuote("'{a''b}' rest")).toBe(false);
    expect(hasUnterminatedIcuQuote("'{a''b} rest")).toBe(true);
  });
  it('treats an apostrophe before a non-syntax char as literal', () => {
    expect(hasUnterminatedIcuQuote("the users' files")).toBe(false);
  });
});
