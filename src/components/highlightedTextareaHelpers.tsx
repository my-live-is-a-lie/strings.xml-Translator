import React from 'react';

// Pure helpers for HighlightedTextarea: whitespace markers, content height measuring and line-rearrange states.

/**
 * Renders text with high-visibility typing mistake indicators for consecutive spaces (2 or more spaces in a row),
 * matching Weblate's red dotted box with middle dots (····) around multiple spaces between words.
 */
/**
 * Placeholder tokens protected inside the translation box: printf-style format specifiers
 * (same shape placeholderCheck.ts uses) and simple ICU variable references like {count}.
 */
export const PRINTF_TOKEN_SOURCE = String.raw`%(?:\d+\$)?[+-]?\d*(?:\.\d+)?[bcdefgopsx%]`;
// Simple refs ({count}) and full single-level arguments ({date, date, medium}).
// The style segment excludes braces, so a block with nested clauses (plural/select bodies)
// never matches: those stay editable structure, not a chip.
export const ICU_VAR_TOKEN_SOURCE = String.raw`\{[A-Za-z0-9_-]+(?:\s*,\s*[a-zA-Z]+(?:\s*,\s*[^{}]+?)?)?\}`;

/** Ranges [start, end) of every atomic token in the text. */
export function findAtomicTokens(text: string, tokenRe: RegExp): Array<[number, number]> {
  const re = new RegExp(tokenRe.source, tokenRe.flags.includes('g') ? tokenRe.flags : tokenRe.flags + 'g');
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/**
 * Atomic editing for protected placeholder tokens.
 * - Backspace right after a token (or Delete right before one) removes the whole token as one unit.
 * - A selection that partially overlaps tokens expands to cover them fully before deleting.
 * - Typing while the caret sits strictly inside a token snaps the caret past the token first,
 *   so the token itself can never be edited.
 * Returns true when the key was handled here.
 */
export function handleAtomicTokenKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  tokenRe: RegExp
): boolean {
  const ta = e.currentTarget;
  const { selectionStart: s, selectionEnd: en, value: v } = ta;
  if (s === null || en === null) return false;
  const tokens = findAtomicTokens(v, tokenRe);
  if (!tokens.length) return false;
  const inside = s === en ? tokens.find(([a, b]) => s > a && s < b) : undefined;

  const commit = (start: number, end: number) => {
    e.preventDefault();
    // Route through the native value setter so React's value tracker notices the change,
    // then dispatch a real input event so the normal onChange pipeline runs (auto-grow, auto-close...).
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, v.slice(0, start) + v.slice(end));
    ta.setSelectionRange(start, start);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  if (s !== en && (e.key === 'Backspace' || e.key === 'Delete')) {
    const overlapping = tokens.filter(([a, b]) => a < en && b > s);
    if (overlapping.length) {
      commit(Math.min(s, overlapping[0][0]), Math.max(en, overlapping[overlapping.length - 1][1]));
      return true;
    }
    return false;
  }

  if (s === en) {
    if (e.key === 'Backspace') {
      const t = tokens.find(([, b]) => b === s) ?? inside;
      if (t) { commit(t[0], t[1]); return true; }
    }
    if (e.key === 'Delete') {
      const t = tokens.find(([a]) => a === s) ?? inside;
      if (t) { commit(t[0], t[1]); return true; }
    }
    if ((e.key.length === 1 && !e.ctrlKey && !e.metaKey) || e.key === 'Enter') {
      if (inside) {
        e.preventDefault();
        ta.setSelectionRange(inside[1], inside[1]);
        document.execCommand('insertText', false, e.key === 'Enter' ? '\n' : e.key);
        return true;
      }
    }
  }
  return false;
}

export function renderContentWithWhitespaceIndicators(
  text: string,
  suppressLineBreakIndicators = false,
  tokenRe?: RegExp | null
) {
  if (!text) return null;

  // Split text by 2 or more consecutive spaces and by line breaks
  const parts = text.split(/( {2,}|\r?\n)/g);

  return parts.map((part, idx) => {
    if (!part) return null;

    if (part === '\n' || part === '\r\n') {
      if (suppressLineBreakIndicators) {
        // Formatting line break (e.g. ICU raw view): keep the break for layout, draw no ↵ mark.
        return (
          <span key={idx} className="opacity-0 select-none whitespace-pre-wrap">
            {'\n'}
          </span>
        );
      }
      // Line break: a ↵ mark at the end of the line, like Weblate. It takes no width (so the text underneath never
      // shifts), then the break itself is kept so the lines wrap exactly as in the textarea.
      return (
        <React.Fragment key={idx}>
          <span
            aria-hidden="true"
            className="relative inline-block select-none align-baseline"
            style={{ width: 0, lineHeight: 'inherit' }}
            title="Line break (\n)"
          >
            {/* a zero-width space gives the wrapper the height of a text line, so the mark sits on that line */}
            {'\u200b'}
            <span
              className="absolute top-0 whitespace-pre text-center"
              style={{
                insetInlineStart: 0,
                padding: '0 3px',
                lineHeight: 'inherit',
                color: '#9aa4b2',
                outline: '1px dotted #FF1E1E',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                borderRadius: '2px',
              }}
            >
              ↵
            </span>
          </span>
          <span className="opacity-0 select-none whitespace-pre-wrap">{'\n'}</span>
        </React.Fragment>
      );
    }

    if (/^ {2,}$/.test(part)) {
      // Start-of-line indentation (right after a line break, or at the very start) is raw-XML
      // formatting, not a typing mistake — the QA side already ignores it
      // (hasMidLineDoubleSpaces), so the markers do too. Only a mid-line run gets the warning box.
      // Note: the split inserts empty strings between adjacent separators ("\n" then spaces),
      // so look back to the last non-empty part, not just parts[idx - 1].
      const prev = parts.slice(0, idx).filter(Boolean).pop();
      const isLineStartIndent = prev === undefined || prev === '\n' || prev === '\r\n';
      if (isLineStartIndent) {
        return (
          <span key={idx} className="opacity-0 select-none whitespace-pre-wrap">
            {part}
          </span>
        );
      }
      const spaceCount = part.length;
      // The marker must take exactly the width of the spaces (no border/padding/margin), otherwise the text after it
      // drifts away from the real text in the textarea underneath. The dotted frame is an outline, which takes no space.
      return (
        <span
          key={idx}
          className="select-none whitespace-pre"
          style={{
            outline: '1px dotted #FF1E1E',
            outlineOffset: '0px',
            backgroundColor: 'rgba(239, 68, 68, 0.18)',
            borderRadius: '2px',
          }}
          title={`${spaceCount} consecutive spaces (typing mistake)`}
        >
          {Array.from({ length: spaceCount }).map((_, dIdx) => (
            <span key={dIdx} className="relative inline-block whitespace-pre" aria-hidden="true">
              <span className="opacity-0"> </span>
              <span className="absolute inset-0 text-center leading-none text-[#FF4D4D] font-bold" style={{ lineHeight: 'inherit' }}>
                ·
              </span>
            </span>
          ))}
        </span>
      );
    }

    // Normal text part: render invisible text so layout matches the textarea exactly.
    // Protected placeholder tokens are the exception: they render as visible solid chips that
    // sit exactly on top of the textarea's own glyphs (same text, same font metrics, no width change).
    if (tokenRe) {
      const matches = part.match(tokenRe);
      if (matches && matches.length) {
        const pieces = part.split(tokenRe);
        const out: React.ReactNode[] = [];
        pieces.forEach((piece, i) => {
          if (piece) {
            out.push(
              <span key={`p${i}`} className="opacity-0 select-none whitespace-pre-wrap">
                {piece}
              </span>
            );
          }
          if (i < matches.length) {
            out.push(
              <span
                key={`t${i}`}
                className="select-none whitespace-pre-wrap protected-token-chip"
                title="Protected placeholder"
              >
                {matches[i]}
              </span>
            );
          }
        });
        return <React.Fragment key={idx}>{out}</React.Fragment>;
      }
    }
    return (
      <span key={idx} className="opacity-0 select-none whitespace-pre-wrap">
        {part}
      </span>
    );
  });
}

/**
 * Measures the exact rendered height of text inside a textarea in pixels
 */
export function getTextContentHeight(ta: HTMLTextAreaElement, text: string): number {
  if (!text) return 0;
  try {
    const computed = window.getComputedStyle(ta);
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.left = '-9999px';
    probe.style.top = '-9999px';
    probe.style.width = `${ta.clientWidth || 300}px`;
    probe.style.font = computed.font;
    probe.style.fontSize = computed.fontSize;
    probe.style.fontFamily = computed.fontFamily;
    probe.style.fontWeight = computed.fontWeight;
    probe.style.fontStyle = computed.fontStyle;
    probe.style.lineHeight = computed.lineHeight;
    probe.style.letterSpacing = computed.letterSpacing;
    probe.style.whiteSpace = 'pre-wrap';
    probe.style.wordBreak = 'break-word';
    probe.style.overflowWrap = 'break-word';
    probe.textContent = text;
    document.body.appendChild(probe);
    const height = probe.clientHeight;
    document.body.removeChild(probe);
    return height;
  } catch {
    const lineCount = text.split('\n').length;
    return lineCount * 22;
  }
}

/**
 * Computes progressive states where empty lines between text blocks are collapsed from bottom to top.
 * State 0 is the original text.
 * State 1 has the bottom-most empty line collapsed (bottom text moved up to the empty line).
 * Subsequent states collapse higher empty lines one by one.
 */
export function computeRearrangeStates(text: string): string[] {
  if (!text) return [text];
  const lines = text.split('\n');
  if (lines.length < 3) return [text];

  // Find line indices that are empty lines between non-empty text lines
  const gapIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      const hasBefore = lines.slice(0, i).some((l) => l.trim() !== '');
      const hasAfter = lines.slice(i + 1).some((l) => l.trim() !== '');
      if (hasBefore && hasAfter) {
        gapIndices.push(i);
      }
    }
  }

  if (gapIndices.length === 0) {
    return [text];
  }

  // Sort from bottom to top so bottom text moves up first
  const collapsibleGaps = [...gapIndices].sort((a, b) => b - a);
  const states: string[] = [text];

  for (let k = 1; k <= collapsibleGaps.length; k++) {
    const gapsToRemove = new Set(collapsibleGaps.slice(0, k));
    const nextLines = lines.filter((_, idx) => !gapsToRemove.has(idx));
    states.push(nextLines.join('\n'));
  }

  return states;
}

export interface RearrangeHistory {
  states: string[];
  currentIndex: number;
}
