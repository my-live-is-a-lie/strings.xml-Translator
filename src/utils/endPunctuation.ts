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

/** Makes the target end with the same mark as the source: replaces a different final mark, or appends a missing one. */
export function fixTargetEnding(source: string, target: string): { text: string; changed: boolean } {
  if (!target.trim()) return { text: target, changed: false };
  const srcRun = sourceEnding(source);
  if (!srcRun) return { text: target, changed: false };
  const trimmed = target.trimEnd();
  const tgtRun = trimmed.match(END_RUN)?.[0] ?? '';
  if (tgtRun && normalizeRun(tgtRun) === normalizeRun(srcRun)) return { text: target, changed: false };
  // Arabic-script translations use the Arabic question mark
  const mark = /[\u0600-\u06FF]/.test(trimmed) ? srcRun.replace(/\?/g, '؟') : srcRun;
  return { text: trimmed.slice(0, trimmed.length - tgtRun.length) + mark, changed: true };
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
