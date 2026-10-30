import type { ResourceItem } from '../types';

type Ending = 'period' | 'ellipsis' | null;

/** Detects a closing full stop or ellipsis at the end of a text (ignores trailing whitespace). */
export function sourceEnding(text: string): Ending {
  const t = text.trimEnd();
  if (/(\.\.\.|…)$/.test(t)) return 'ellipsis';
  if (/\.$/.test(t)) return 'period';
  return null;
}

function targetHasEnding(text: string, ending: Exclude<Ending, null>): boolean {
  const t = text.trimEnd();
  if (ending === 'ellipsis') return /(\.\.\.|…)$/.test(t);
  return /[.。۔…]$/.test(t);
}

/** Returns the target with the source's final period / ellipsis appended when it is missing. */
export function fixTargetEnding(source: string, target: string): { text: string; changed: boolean } {
  if (!target.trim()) return { text: target, changed: false };
  const ending = sourceEnding(source);
  if (!ending || targetHasEnding(target, ending)) return { text: target, changed: false };
  const mark = ending === 'ellipsis' ? (/…\s*$/.test(source) ? '…' : '...') : '.';
  return { text: target.trimEnd() + mark, changed: true };
}

/** Adds the missing final period/ellipsis to every translated entry of an item. */
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
