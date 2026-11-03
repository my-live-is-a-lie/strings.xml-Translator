import { scanBrackets } from './syntaxFix';

const OPENER_TO_CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}', '«': '»', '“': '”', '﴿': '﴾', '‘': '’', '‹': '›' };

/**
 * Live typing helper: when the user has just typed a second consecutive space and an opening bracket before it
 * is still unclosed, closes the nearest unclosed bracket there and leaves a single space after it.
 * Returns null when nothing should change.
 */
export function autoCloseOnDoubleSpace(prev: string, next: string, caret: number): { text: string; caret: number } | null {
  if (next.length !== prev.length + 1 || caret < 2) return null;
  let head: string;
  if (next.slice(caret - 2, caret) === '  ' && next.slice(0, caret - 1) + next.slice(caret) === prev) {
    head = next.slice(0, caret - 2); // two plain spaces
  } else if (next.slice(caret - 2, caret) === '. ' && next.slice(0, caret - 2) + next.slice(caret - 1) === prev && /\s$/.test(prev.slice(0, caret - 1))) {
    // Keyboards that turn a double space into ". " (period + space): the period it adds is not wanted
    head = next.slice(0, caret - 2);
  } else return null;
  const { unclosed } = scanBrackets(head);
  const candidates: { idx: number; closer: string }[] = unclosed.map((u) => ({ idx: u.idx, closer: OPENER_TO_CLOSER[u.ch] }));
  // Straight quotes open and close with the same character: an odd count means the last one is still open.
  // Tags (attributes) and apostrophes inside words (don't) are not quotes.
  const plain = head.replace(/<[^>]*>/g, (m) => ' '.repeat(m.length));
  for (const q of ['"', "'"]) {
    const at: number[] = [];
    for (let i = 0; i < plain.length; i++) {
      if (plain[i] !== q) continue;
      if (q === "'" && /[\p{L}\p{N}]/u.test(plain[i - 1] ?? '') && /[\p{L}\p{N}]/u.test(plain[i + 1] ?? '')) continue;
      at.push(i);
    }
    if (at.length % 2 === 1) candidates.push({ idx: at[at.length - 1], closer: q });
  }
  if (candidates.length === 0) return null;
  const nearest = candidates.reduce((a, b) => (b.idx > a.idx ? b : a));
  const closer = nearest.closer;
  const rest = next.slice(caret).replace(/^ /, '');
  return { text: head + closer + ' ' + rest, caret: head.length + closer.length + 1 };
}
