import type { ResourceItem } from '../types';

/**
 * Line breaks in Android strings are written as the two characters `\n`. The editor shows each one as a real
 * line break (with a ↵ mark, like Weblate), so the translator presses Enter instead of typing `\n`.
 * The stored text keeps the `\n` form: only the editor works with real line breaks.
 *
 * A `\\n` (escaped backslash followed by n) is not a line break and is left alone. In the raw XML a real
 * line break right before a `\n` is only formatting, so it is ignored.
 */

/**
 * Stored form -> editor form: every `\n` becomes a real line break. When loading stored text, a real break right
 * before a `\n` is raw-XML formatting and is dropped; while typing (`dropFormatting` false) it is the person's own break.
 */
export function toEditorText(text: string, dropFormatting = true): string {
  if (!text) return text;
  const s = dropFormatting ? text.replace(/\r?\n(?=\\n)/g, '') : text;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === 'n') {
        out += '\n';
        i++;
        continue;
      }
      if (next === '\\') {
        out += '\\\\';
        i++;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** Editor form -> stored form: every real line break becomes `\n`. */
export function toStoredText(text: string): string {
  if (!text) return text;
  return text.replace(/\r?\n/g, '\\n');
}

/**
 * While typing: a `\n` typed by hand turns into a real line break at once; the caret moves back by the
 * characters that disappeared before it.
 */
export function normalizeTypedBreaks(text: string, caret: number): { text: string; caret: number } {
  const converted = toEditorText(text, false);
  if (converted === text) return { text, caret };
  const before = toEditorText(text.slice(0, Math.min(caret, text.length)), false);
  return { text: converted, caret: before.length };
}

/** How many line breaks a text has (either form). Formatting breaks right before a `\n` do not count. */
export function countLineBreaks(text: string): number {
  if (!text) return 0;
  return (toEditorText(text).match(/\n/g) || []).length;
}

/** Positive: the translation lacks that many line breaks; negative: it has that many too many. */
export function lineBreakDifference(source: string, target: string): number {
  return countLineBreaks(source) - countLineBreaks(target);
}

const mapTargets = (item: ResourceItem, fn: (t: string) => string): ResourceItem => {
  if (item.type === 'string') {
    const target = fn(item.target || '');
    return target === item.target ? item : { ...item, target };
  }
  let changed = false;
  const items = item.items.map((x) => {
    const target = fn(x.target || '');
    if (target === x.target) return x;
    changed = true;
    return { ...x, target };
  });
  return changed ? ({ ...item, items } as ResourceItem) : item;
};

export const toEditorItem = (item: ResourceItem, dropFormatting = true): ResourceItem =>
  mapTargets(item, (t) => toEditorText(t, dropFormatting));
export const toStoredItem = (item: ResourceItem): ResourceItem => mapTargets(item, toStoredText);
