import { scanBrackets } from './syntaxFix';

const OPENER_TO_CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}', '«': '»', '“': '”' };

/**
 * Live typing helper: when the user has just typed a second consecutive space and an opening bracket before it
 * is still unclosed, closes the nearest unclosed bracket there and leaves a single space after it.
 * Returns null when nothing should change.
 */
export function autoCloseOnDoubleSpace(prev: string, next: string, caret: number): { text: string; caret: number } | null {
  if (next.length !== prev.length + 1 || caret < 2) return null;
  if (next.slice(caret - 2, caret) !== '  ') return null;
  if (next.slice(0, caret - 1) + next.slice(caret) !== prev) return null; // a single typed character
  const head = next.slice(0, caret - 2);
  const { unclosed } = scanBrackets(head);
  if (unclosed.length === 0) return null;
  const nearest = unclosed.reduce((a, b) => (b.idx > a.idx ? b : a));
  const closer = OPENER_TO_CLOSER[nearest.ch];
  const rest = next.slice(caret).replace(/^ /, '');
  return { text: head + closer + ' ' + rest, caret: head.length + closer.length + 1 };
}
