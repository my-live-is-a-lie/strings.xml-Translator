import { ResourceItem, TranslationProject } from '../types';
import { normalizePluralsForLanguage } from './xmlParser';

export interface SourceDiff {
  added: string[]; // resource names that only exist in the new file
  removed: string[]; // names that only exist in the current project
  changed: string[]; // same name, different source text
  unchanged: string[];
}

/** Source text of an item as a single comparable string. */
function sourceSignature(item: ResourceItem): string {
  if (item.type === 'string') return item.source;
  if (item.type === 'plural') return JSON.stringify(item.items.map((q) => [q.quantity, q.source]));
  return JSON.stringify(item.items.map((e) => [e.index, e.source]));
}

/** Plurals are compared on the quantities both sides have, because each side may list different ones per language. */
function sameSource(a: ResourceItem, b: ResourceItem): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'plural' && b.type === 'plural') {
    const bySource = new Map(b.items.map((q) => [q.quantity, q.source]));
    return a.items.every((q) => !bySource.has(q.quantity) || bySource.get(q.quantity) === q.source);
  }
  return sourceSignature(a) === sourceSignature(b);
}

export function diffSources(current: ResourceItem[], incoming: ResourceItem[]): SourceDiff {
  const currentByName = new Map(current.map((i) => [i.name, i]));
  const incomingNames = new Set(incoming.map((i) => i.name));
  const diff: SourceDiff = { added: [], removed: [], changed: [], unchanged: [] };

  for (const item of incoming) {
    const existing = currentByName.get(item.name);
    if (!existing) diff.added.push(item.name);
    else if (sameSource(existing, item)) diff.unchanged.push(item.name);
    else diff.changed.push(item.name);
  }
  for (const item of current) {
    if (!incomingNames.has(item.name)) diff.removed.push(item.name);
  }
  return diff;
}

/** Old source text of the parts that differ, keyed by '' (string), plural quantity or array index. */
function previousSourcesOf(existing: ResourceItem, item: ResourceItem): Record<string, string> {
  const out: Record<string, string> = {};
  if (existing.type === 'string' && item.type === 'string') {
    if (existing.source !== item.source) out[''] = existing.source;
  } else if (existing.type === 'plural' && item.type === 'plural') {
    const old = new Map(existing.items.map((q) => [q.quantity, q.source]));
    for (const q of item.items) if (old.has(q.quantity) && old.get(q.quantity) !== q.source) out[q.quantity] = old.get(q.quantity) as string;
  } else if (existing.type === 'array' && item.type === 'array') {
    const old = new Map(existing.items.map((e) => [e.index, e.source]));
    for (const e of item.items) if (old.has(e.index) && old.get(e.index) !== e.source) out[String(e.index)] = old.get(e.index) as string;
  }
  return out;
}

function hasTarget(item: ResourceItem): boolean {
  if (item.type === 'string') return item.target.trim().length > 0;
  return item.items.some((x) => x.target.trim().length > 0);
}

/**
 * Builds the new item list in the order of the new file. Existing translations are kept:
 * unchanged strings stay as they are, strings whose source text changed keep their old translation
 * but are marked "needs review", and new strings start untranslated. Removed strings are dropped.
 */
export function mergeSourceUpdate(current: ResourceItem[], incoming: ResourceItem[]): ResourceItem[] {
  const currentByName = new Map(current.map((i) => [i.name, i]));

  return incoming.map((item, order) => {
    const existing = currentByName.get(item.name);
    if (!existing || existing.type !== item.type) return { ...item, order, sourceChange: 'added' };

    const unchanged = sameSource(existing, item);
    // Carry targets over by quantity / index so a different plural set per language still lines up
    let merged: ResourceItem;
    if (item.type === 'string' && existing.type === 'string') {
      merged = { ...item, target: existing.target };
    } else if (item.type === 'plural' && existing.type === 'plural') {
      const targets = new Map(existing.items.map((q) => [q.quantity, q.target]));
      merged = { ...item, items: item.items.map((q) => ({ ...q, target: targets.get(q.quantity) ?? q.target })) };
    } else if (item.type === 'array' && existing.type === 'array') {
      const targets = new Map(existing.items.map((e) => [e.index, e.target]));
      merged = { ...item, items: item.items.map((e) => ({ ...e, target: targets.get(e.index) ?? e.target })) };
    } else {
      return { ...item, order };
    }

    if (unchanged) {
      // Flags describe only the latest update, so they are not carried over
      return { ...merged, id: existing.id, order, status: existing.status, translationSource: existing.translationSource, translationEngine: existing.translationEngine };
    }
    return {
      ...merged,
      id: existing.id,
      order,
      status: hasTarget(merged) ? 'needs_review' : 'untranslated',
      sourceChange: 'changed' as const,
      previousSources: previousSourcesOf(existing, item),
      translationSource: existing.translationSource,
      translationEngine: existing.translationEngine,
    };
  });
}

/** Applies a new source file to a project, including the cached translations of the other languages. */
export function applySourceUpdate(
  project: TranslationProject,
  incomingItems: ResourceItem[],
  raw: { rawSourceXml?: string; resourcesAttributes?: string; indentStyle?: string; itemIndentStyle?: string }
): TranslationProject {
  const forLang = (lang: string) => normalizePluralsForLanguage(incomingItems, lang);
  const translationsByLang = project.translationsByLang
    ? Object.fromEntries(
        Object.entries(project.translationsByLang).map(([lang, items]) => [lang, mergeSourceUpdate(items, forLang(lang))])
      )
    : undefined;

  return {
    ...project,
    items: mergeSourceUpdate(project.items, forLang(project.targetLang)),
    translationsByLang,
    rawSourceXml: raw.rawSourceXml ?? project.rawSourceXml,
    resourcesAttributes: raw.resourcesAttributes ?? project.resourcesAttributes,
    indentStyle: raw.indentStyle ?? project.indentStyle,
    itemIndentStyle: raw.itemIndentStyle ?? project.itemIndentStyle,
    lastModified: Date.now(),
  };
}
