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

/**
 * True when `text` has a run of two or more spaces that is NOT just the start-of-line
 * indentation copied from raw XML (the space run right after a line break, or at the very
 * start of the text). That indentation is formatting, not a typo a translator made; a double
 * space in the middle of a sentence still is. Accepts either stored or editor form.
 */
export function hasMidLineDoubleSpaces(text: string): boolean {
  if (!text) return false;
  const editorText = toEditorText(text);
  for (const m of editorText.matchAll(/ {2,}/g)) {
    if (m.index !== 0 && editorText[m.index - 1] !== '\n') return true;
  }
  return false;
}

/**
 * Collapses only mid-line double spaces (see `hasMidLineDoubleSpaces`) down to a single space;
 * start-of-line indentation is left untouched. Accepts either stored or editor form (like its
 * sibling) but always returns editor form, since every current caller already holds and expects
 * editor-form text; normalizing here just keeps a future stored-form caller from misreading a
 * literal `\n` as ordinary characters instead of a line start.
 */
export function collapseMidLineDoubleSpaces(text: string): string {
  if (!text) return text;
  const editorText = toEditorText(text);
  return editorText.replace(/ {2,}/g, (match, offset: number, full: string) =>
    offset === 0 || full[offset - 1] === '\n' ? match : ' '
  );
}

/**
 * Raw-XML pretty printing wraps a string's text in formatting whitespace: the line break and
 * indentation of the <string> element itself (`\n        Price: ...\n    `). None of it is
 * translatable, but the plain editor showed it as blank lines and space markers, and the save
 * gate counts those line breaks, so the translator had to keep the clutter. The editor now
 * hides such an edge run and keeps it aside, re-attaching it on save, so the stored file keeps
 * its exact formatting.
 *
 * A run only counts as formatting when it holds a line break AND the source has a whitespace
 * run with a line break at the same end: the source's run proves the slot is layout, not text.
 * A leading/trailing run the source does not have, or one without a line break (the space in
 * `<string> text</string>`), is content the translator put there and stays visible and editable.
 */
export interface FormattingEdges {
  leading: string;
  trailing: string;
}

const LEADING_WHITESPACE_RUN = /^\s+/;
const TRAILING_WHITESPACE_RUN = /\s+$/;

/**
 * Splits the hideable formatting whitespace off the ends of an editor-form target. `source` is
 * the parsed source text (its real line breaks mark the formatting runs; a literal `\n` in it is
 * content and never counts).
 */
export function splitFormattingEdges(
  source: string,
  target: string
): { core: string; edges: FormattingEdges | null } {
  if (!target) return { core: target, edges: null };
  // A target that is nothing but whitespace is a single run, not a leading and a trailing one.
  const whitespaceOnly = /^\s+$/.test(target);
  const leading = whitespaceOnly ? target : (LEADING_WHITESPACE_RUN.exec(target)?.[0] ?? '');
  const trailing = whitespaceOnly ? '' : (TRAILING_WHITESPACE_RUN.exec(target)?.[0] ?? '');
  const sourceLeading = LEADING_WHITESPACE_RUN.exec(source)?.[0] ?? '';
  const sourceTrailing = TRAILING_WHITESPACE_RUN.exec(source)?.[0] ?? '';
  const hideLeading = leading.includes('\n') && sourceLeading.includes('\n');
  const hideTrailing = trailing.includes('\n') && sourceTrailing.includes('\n');
  if (!hideLeading && !hideTrailing) return { core: target, edges: null };
  const edges: FormattingEdges = {
    leading: hideLeading ? leading : '',
    trailing: hideTrailing ? trailing : '',
  };
  return { core: target.slice(edges.leading.length, target.length - edges.trailing.length), edges };
}

/**
 * The source's own formatting edges, borrowed for a target that has none of its own yet: a
 * fresh translation then saves with the file's exact formatting (and its line-break count)
 * instead of tripping the line-break save gate.
 */
export function sourceFormattingEdges(source: string): FormattingEdges | null {
  if (!source) return null;
  const leading = LEADING_WHITESPACE_RUN.exec(source)?.[0] ?? '';
  const trailing = TRAILING_WHITESPACE_RUN.exec(source)?.[0] ?? '';
  const edges: FormattingEdges = {
    leading: leading.includes('\n') ? leading : '',
    trailing: trailing.includes('\n') ? trailing : '',
  };
  return edges.leading || edges.trailing ? edges : null;
}

/**
 * Puts hidden formatting edges back around the target for saving and QA. An end that already
 * has a whitespace run with a line break (e.g. reassembled from the ICU branch editor, which
 * restores this whitespace from the source) is left alone, so the edges are never doubled. An
 * empty target stays empty: an untranslated string must not become whitespace-only.
 */
export function restoreFormattingEdges(target: string, edges: FormattingEdges | null | undefined): string {
  if (!edges || !target.trim()) return target;
  let out = target;
  if (edges.leading && !/^\s*\n/.test(out)) out = edges.leading + out;
  if (edges.trailing && !/\n\s*$/.test(out)) out += edges.trailing;
  return out;
}

/**
 * The interior twin of the formatting edges: the pretty-print indentation at the start of each
 * line inside a multi-line string (`{\n    =0 {…}\n}`). The raw text view shows the message
 * without that indentation, the way the plain editor shows a string without its edges, so the
 * file's original layout can neither be seen as editable text nor corrupted by typing.
 *
 * A line's leading run counts as formatting only when the SOURCE line at the same position also
 * starts with a whitespace run: the source's run proves the slot is layout. A run the source
 * does not have (real indentation the translator wrote) stays visible and editable.
 */
export interface FormattingIndents {
  /** One entry per line of the core text: the hidden line-start run, or null when the line has none. */
  lines: (string | null)[];
}

const LINE_START_RUN = /^[ \t]+/;

/**
 * Removes the hideable line-start indentation from an editor-form target core (edges already
 * split off). Pair `sourceCore` the same way (the source with its own edges off), so line
 * positions line up. Pass the source as its own target to read its pattern alone (used to
 * borrow the formatting for a not-yet-translated string).
 */
export function splitInteriorIndents(
  sourceCore: string,
  targetCore: string
): { display: string; indents: FormattingIndents | null } {
  if (!targetCore || !targetCore.includes('\n')) return { display: targetCore, indents: null };
  const sourceLines = sourceCore.split('\n');
  const targetLines = targetCore.split('\n');
  let any = false;
  const lines: (string | null)[] = targetLines.map((line, i) => {
    const indent = LINE_START_RUN.exec(line)?.[0] ?? null;
    if (!indent) return null;
    const sourceHasSlot = i < sourceLines.length && LINE_START_RUN.test(sourceLines[i]);
    if (!sourceHasSlot) return null;
    any = true;
    return indent;
  });
  if (!any) return { display: targetCore, indents: null };
  const display = targetLines.map((line, i) => (lines[i] ? line.slice(lines[i]!.length) : line)).join('\n');
  return { display, indents: { lines } };
}

/**
 * Puts hidden line-start indentation back for saving and QA. A line that already starts with
 * its hidden run (e.g. reassembled from the ICU branch editor) is left alone, so indentation
 * is never doubled. An empty target stays empty.
 */
export function restoreInteriorIndents(target: string, indents: FormattingIndents | null | undefined): string {
  if (!indents || !target.trim()) return target;
  return target
    .split('\n')
    .map((line, i) => {
      const indent = indents.lines[i];
      if (!indent || line.startsWith(indent)) return line;
      return indent + line;
    })
    .join('\n');
}

/**
 * Merges a freshly captured set of indents into the kept one. The kept (original) run always
 * wins its slot: it is the file's own formatting, so whitespace that arrives later at a hidden
 * slot — retyped by hand, pasted, or reassembled — never rewrites the original layout. New
 * slots only appear when text arrives carrying source-matched indentation of its own (a
 * suggestion, a paste), the same way a fresh translation borrows the source's edges.
 */
export function mergeFormattingIndents(
  kept: FormattingIndents | null,
  arriving: FormattingIndents | null
): FormattingIndents | null {
  if (!kept) return arriving;
  if (!arriving) return kept;
  const length = Math.max(kept.lines.length, arriving.lines.length);
  const lines = Array.from({ length }, (_, i) => kept.lines[i] ?? arriving.lines[i] ?? null);
  return lines.some(Boolean) ? { lines } : null;
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
