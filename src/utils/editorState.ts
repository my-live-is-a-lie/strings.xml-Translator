// Pure state transitions of the editor (project + undo history). Kept outside App so they can be tested
// and App only wires them to React state.
import { ResourceItem, TranslationProject } from '../types';
import { mergeTargetXml, normalizePluralsForLanguage } from './xmlParser';
import { SAMPLE_TARGET_ARABIC_XML, SAMPLE_TARGET_SPANISH_XML } from './sampleData';
import { getLanguageOption } from './languages';
import { applySourceUpdate } from './sourceDiff';
import { blankItems } from './multiLang';

export interface HistorySnapshot {
  items: ResourceItem[];
  targetLang: string;
  targetLocaleName?: string;
  translationsByLang?: Record<string, ResourceItem[]>;
  selectedId: string;
}

export interface EditorState {
  project: TranslationProject;
  selectedId: string;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
}

export const MAX_HISTORY_STEPS = 100;

export function snapshotOf(state: EditorState): HistorySnapshot {
  const p = state.project;
  return {
    items: p.items,
    targetLang: p.targetLang,
    targetLocaleName: p.targetLocaleName,
    translationsByLang: p.translationsByLang,
    selectedId: state.selectedId,
  };
}

/** Pushes the current state onto the undo stack and clears redo. */
function withHistory(curr: EditorState, project: TranslationProject, selectedId = curr.selectedId): EditorState {
  return {
    ...curr,
    project,
    selectedId,
    past: [...curr.past.slice(-(MAX_HISTORY_STEPS - 1)), snapshotOf(curr)],
    future: [],
  };
}

/** Switches the open language; every language keeps its own translations in translationsByLang. */
export function changeLanguage(curr: EditorState, newLocale: string): EditorState {
  const prev = curr.project;
  const currentLang = prev.targetLang;
  if (currentLang.toLowerCase() === newLocale.toLowerCase()) return curr;

  const cache = { ...(prev.translationsByLang || {}), [currentLang]: prev.items };

  let newItems: ResourceItem[];
  if (cache[newLocale] && cache[newLocale].length === prev.items.length) {
    newItems = normalizePluralsForLanguage(cache[newLocale], newLocale);
  } else if (newLocale === 'es' && SAMPLE_TARGET_SPANISH_XML) {
    newItems = mergeTargetXml(prev.items, SAMPLE_TARGET_SPANISH_XML, 'es').updatedItems;
  } else if (newLocale === 'ar' && SAMPLE_TARGET_ARABIC_XML) {
    newItems = mergeTargetXml(prev.items, SAMPLE_TARGET_ARABIC_XML, 'ar').updatedItems;
  } else {
    newItems = normalizePluralsForLanguage(blankItems(prev.items), newLocale);
  }

  const langOpt = getLanguageOption(newLocale);
  return withHistory(curr, {
    ...prev,
    targetLang: newLocale,
    targetLocaleName: langOpt.nativeName || langOpt.name || newLocale,
    items: newItems,
    translationsByLang: cache,
    lastModified: Date.now(),
  });
}

/** Replaces the items whose ids appear in `updatedItems` (used by bulk translate). */
export function bulkUpdate(curr: EditorState, updatedItems: ResourceItem[]): EditorState {
  const byId = new Map(updatedItems.map((u) => [u.id, u]));
  const prev = curr.project;
  return withHistory(curr, {
    ...prev,
    items: prev.items.map((item) => byId.get(item.id) || item),
    lastModified: Date.now(),
  });
}

/** Stores languages translated in bulk; the open language is edited live, so it is skipped. */
export function saveLanguages(curr: EditorState, byLang: Record<string, ResourceItem[]>): EditorState {
  const cache = { ...(curr.project.translationsByLang || {}) };
  for (const [code, items] of Object.entries(byLang)) {
    if (code.toLowerCase() === curr.project.targetLang.toLowerCase()) continue;
    cache[code] = items;
  }
  return { ...curr, project: { ...curr.project, translationsByLang: cache, lastModified: Date.now() } };
}

/** Applies a newer source file while keeping translations (see sourceDiff). */
export function updateSource(
  curr: EditorState,
  parsed: { items: ResourceItem[]; resourcesAttributes?: string; indentStyle?: string; itemIndentStyle?: string },
  rawXml: string
): EditorState {
  const next = applySourceUpdate(curr.project, parsed.items, {
    rawSourceXml: rawXml,
    resourcesAttributes: parsed.resourcesAttributes,
    indentStyle: parsed.indentStyle,
    itemIndentStyle: parsed.itemIndentStyle,
  });
  const stillThere = next.items.some((i) => i.id === curr.selectedId);
  return withHistory(curr, next, stillThere ? curr.selectedId : next.items[0]?.id ?? '');
}
