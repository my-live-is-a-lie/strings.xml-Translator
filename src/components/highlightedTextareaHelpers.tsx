import React from 'react';

// Pure helpers for HighlightedTextarea: whitespace markers, content height measuring and line-rearrange states.

/**
 * Renders text with high-visibility typing mistake indicators for consecutive spaces (2 or more spaces in a row),
 * matching Weblate's red dotted box with middle dots (····) around multiple spaces between words.
 */
export function renderContentWithWhitespaceIndicators(text: string) {
  if (!text) return null;

  // Split text by 2 or more consecutive spaces
  const parts = text.split(/( {2,})/g);

  return parts.map((part, idx) => {
    if (!part) return null;

    if (/^ {2,}$/.test(part)) {
      const spaceCount = part.length;
      return (
        <span
          key={idx}
          className="relative inline-flex items-center justify-center align-middle select-none"
          style={{
            border: '2px dotted #FF1E1E',
            backgroundColor: 'rgba(239, 68, 68, 0.22)',
            borderRadius: '2px',
            boxShadow: '0 0 6px rgba(255, 30, 30, 0.45)',
            verticalAlign: 'middle',
            height: '1.45em',
            margin: '0 1px',
            boxSizing: 'border-box',
          }}
          title={`${spaceCount} consecutive spaces (typing mistake)`}
        >
          {/* Transparent spaces to reserve exact natural text width */}
          <span className="opacity-0 select-none whitespace-pre leading-none px-0.5">
            {part}
          </span>
          {/* High-visibility centered middle dots representing each whitespace character */}
          <span
            className="absolute inset-0 flex items-center justify-around pointer-events-none text-white font-mono font-black text-xs sm:text-sm select-none leading-none px-[2px] tracking-widest drop-shadow-xs"
            aria-hidden="true"
          >
            {Array.from({ length: spaceCount }).map((_, dIdx) => (
              <span key={dIdx} className="flex-1 text-center font-bold">
                ·
              </span>
            ))}
          </span>
        </span>
      );
    }

    // Normal text part: render invisible text so layout matches the textarea exactly
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
