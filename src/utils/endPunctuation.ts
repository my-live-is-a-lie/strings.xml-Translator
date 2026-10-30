import type { ResourceItem } from '../types';

const END_RUN = /[.!?؟…。۔]+$/;

/** The final run of sentence-ending marks of a text (ignores trailing whitespace), e.g. ".", "...", "?!". */
export function sourceEnding(text: string): string | null {
  const m = text.trimEnd().match(END_RUN);
  return m ? m[0] : null;
}

/** Equivalent marks compare equal: "..." = "…", "؟" = "?", "۔"/"。" = ".". */
function normalizeRun(run: string): string {
  return run
    .replace(/\.{3,}/g, '…')
    .replace(/؟/g, '?')
    .replace(/[。۔]/g, '.');
}

/** Splits a text into [body, whitespace before the final mark, final mark]. */
function splitEnding(text: string): [string, string, string] {
  const t = text.trimEnd();
  const run = t.match(END_RUN)?.[0] ?? '';
  const rest = t.slice(0, t.length - run.length);
  const body = rest.trimEnd();
  return [body, rest.slice(body.length), run];
}

/**
 * Makes the target end like the source: same final mark (replaced or appended when different/missing)
 * and the same spacing before it (a space before "؟" is removed when the source has none, and vice versa).
 */
export function fixTargetEnding(source: string, target: string): { text: string; changed: boolean } {
  if (!target.trim()) return { text: target, changed: false };
  const [srcBody, srcGap0, srcRun] = splitEnding(source);
  if (!srcRun) return { text: target, changed: false };
  const srcGap = srcBody ? srcGap0 : '';
  const [tgtBody, tgtGap, tgtRun] = splitEnding(target);
  const sameRun = !!tgtRun && normalizeRun(tgtRun) === normalizeRun(srcRun);
  const sameGap = !!tgtBody && (tgtGap === '') === (srcGap === '');
  if (sameRun && (sameGap || !tgtBody)) return { text: target, changed: false };
  // Arabic-script translations use the Arabic question mark
  const mark = sameRun
    ? tgtRun
    : /[\u0600-\u06FF]/.test(tgtBody) ? srcRun.replace(/\?/g, '؟') : srcRun;
  return { text: tgtBody + (tgtBody ? srcGap : '') + mark, changed: true };
}

/** Fixes the final punctuation to every translated entry of an item. */
export function fixItemEndings(item: ResourceItem): { item: ResourceItem; changed: boolean } {
  if (item.type === 'string') {
    const r = fixTargetEnding(item.source, item.target);
    return { item: r.changed ? { ...item, target: r.text } : item, changed: r.changed };
  }
  let changed = false;
  if (item.type === 'plural') {
    const items = item.items.map((pi) => {
      const r = fixTargetEnding(pi.source, pi.target);
      if (r.changed) changed = true;
      return r.changed ? { ...pi, target: r.text } : pi;
    });
    return { item: changed ? { ...item, items } : item, changed };
  }
  const items = item.items.map((ai) => {
    const r = fixTargetEnding(ai.source, ai.target);
    if (r.changed) changed = true;
    return r.changed ? { ...ai, target: r.text } : ai;
  });
  return { item: changed ? { ...item, items } : item, changed };
}
