/**
 * Where, in the source text, the reader should be looking while the translator types at `caret` in `target`.
 * Returns 0..1 (fraction of the source text). Used to keep a short window onto a long source in step with the
 * translation. Texts are matched by paragraph (real or Android-escaped "\n" breaks) when there are enough of them,
 * otherwise by sentence, otherwise by the plain character ratio. Inside a part, the position is proportional.
 */

interface Part {
  start: number;
  end: number;
}

const PARAGRAPH_BREAK = /(?:\\n|\r?\n)(?:\s|\\n|\r?\n)*/g;
const SENTENCE_BREAK = /(?:[.!?؟…。]+(?=\s|$|\\n)|\\n|\r?\n)(?:\s|\\n|\r?\n)*/g;

function splitParts(text: string, breaker: RegExp): Part[] {
  const parts: Part[] = [];
  let start = 0;
  for (const m of text.matchAll(breaker)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end > start) parts.push({ start, end });
    start = end;
  }
  if (start < text.length) parts.push({ start, end: text.length });
  return parts;
}

/** The finest split that still gives a few parts; the source decides which one applies to both texts. */
function pickBreaker(source: string): RegExp | null {
  if (splitParts(source, PARAGRAPH_BREAK).length >= 3) return PARAGRAPH_BREAK;
  if (splitParts(source, SENTENCE_BREAK).length >= 2) return SENTENCE_BREAK;
  return null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function sourceRatio(target: string, caret: number, source: string): number {
  if (!source) return 0;
  const pos = Math.min(Math.max(caret, 0), target.length);
  const plain = () => clamp01(pos / Math.max(target.length, source.length * 0.9));
  const breaker = pickBreaker(source);
  if (!breaker || !target) return target ? plain() : 0;

  const sParts = splitParts(source, breaker);
  const tParts = splitParts(target, breaker);
  if (tParts.length === 0) return 0;

  let i = tParts.findIndex((p) => pos < p.end);
  if (i < 0) i = tParts.length - 1;
  const tp = tParts[i];
  // the part is closed when a break follows it (the last part is still being typed unless it ends in one)
  const closed = i < tParts.length - 1 || /(?:\\n|\r?\n|[.!?؟…。])\s*$/.test(target.slice(tp.start, tp.end));

  // Same number of parts: one to one. Fewer (still typing): the same index. More: spread proportionally.
  const j = tParts.length <= sParts.length ? i : Math.round((i * (sParts.length - 1)) / (tParts.length - 1));
  const sp = sParts[Math.min(j, sParts.length - 1)];
  const sLen = sp.end - sp.start;

  // How long this part is expected to be in the target: its real length once closed, otherwise the source
  // part scaled by how the finished parts compare so far (languages differ in length).
  let expected: number;
  if (closed) {
    expected = tp.end - tp.start;
  } else {
    let doneT = 0;
    let doneS = 0;
    for (let k = 0; k < i; k++) {
      doneT += tParts[k].end - tParts[k].start;
      doneS += sParts[Math.min(k, sParts.length - 1)].end - sParts[Math.min(k, sParts.length - 1)].start;
    }
    expected = sLen * (doneS > 0 ? doneT / doneS : 1);
  }
  const frac = expected > 0 ? clamp01((pos - tp.start) / expected) : 0;
  return clamp01((sp.start + frac * sLen) / source.length);
}
