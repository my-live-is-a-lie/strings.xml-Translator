import { useSyncExternalStore } from 'react';
import { ResourceItem } from '../types';

export type QuickFilterId = 'new' | 'review' | 'untranslated' | 'translated' | 'ai' | 'manual';
export const QUICK_FILTER_IDS: readonly QuickFilterId[] = ['new', 'review', 'untranslated', 'translated', 'ai', 'manual'];

const STORAGE_KEY = 'app_quick_filters_v1';

interface QuickFilterState {
  active: readonly QuickFilterId[];
  open: boolean;
  /**
   * Ids of the strings the filters selected at the moment they were switched on/off (or the file/language opened).
   * Kept fixed while translating, so a string you just saved doesn't vanish from the list; null = not taken yet.
   */
  snapshot: ReadonlySet<string> | null;
}

function load(): QuickFilterState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { active?: unknown; open?: unknown };
      const active = Array.isArray(parsed.active)
        ? QUICK_FILTER_IDS.filter((id) => (parsed.active as unknown[]).includes(id))
        : [];
      return { active, open: parsed.open === true, snapshot: null };
    }
  } catch {
    // unreadable storage: start with no filters
  }
  return { active: [], open: false, snapshot: null };
}

let state: QuickFilterState = load();
const listeners = new Set<() => void>();

function commit(next: QuickFilterState): void {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: state.active, open: state.open }));
  } catch {
    // storage unavailable: filters still work for this session
  }
  listeners.forEach((l) => l());
}

function takeSnapshot(items: ResourceItem[], active: readonly QuickFilterId[]): ReadonlySet<string> | null {
  return active.length === 0 ? null : new Set(applyQuickFilters(items, active).map((i) => i.id));
}

export function toggleQuickFilter(id: QuickFilterId, items: ResourceItem[]): void {
  const has = state.active.includes(id);
  const active = QUICK_FILTER_IDS.filter((x) => (x === id ? !has : state.active.includes(x)));
  commit({ ...state, active, snapshot: takeSnapshot(items, active) });
}

/** Re-takes the snapshot (a different file/language was opened, or the strings changed). */
export function resetQuickSnapshot(items: ResourceItem[]): void {
  // "New" only exists while some string carries a source-update flag
  const hasNew = items.some((i) => i.sourceChange);
  const hasReview = items.some((i) => i.status === 'needs_review');
  const active = state.active.filter((id) => (id === 'new' ? hasNew : id === 'review' ? hasReview : true));
  commit({ ...state, active, snapshot: takeSnapshot(items, active) });
}

/** Switches on only the "new" filter (used right after the source file was updated) and opens the bar. */
export function showOnlyNewStrings(items: ResourceItem[]): void {
  const active: readonly QuickFilterId[] = ['new'];
  commit({ ...state, active, open: true, snapshot: takeSnapshot(items, active) });
}

export function toggleQuickFilterBar(): void {
  commit({ ...state, open: !state.open });
}

export function useQuickFilters(): QuickFilterState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
}

/** What the views show: the fixed snapshot when there is one, otherwise the live result of the filters. */
export function applyQuickSnapshot(items: ResourceItem[], qf: Pick<QuickFilterState, 'active' | 'snapshot'>): ResourceItem[] {
  if (qf.active.length === 0) return items;
  const snap = qf.snapshot;
  return snap ? items.filter((i) => snap.has(i.id)) : applyQuickFilters(items, qf.active);
}

/**
 * Within a group (status: untranslated/translated, origin: ai/manual) selected filters are OR'ed;
 * the two groups are AND'ed, so "translated + AI" shows only AI-translated strings.
 * Origin filters only match translated strings.
 */
export function applyQuickFilters(items: ResourceItem[], active: readonly QuickFilterId[]): ResourceItem[] {
  if (active.length === 0) return items;
  const wantNew = active.includes('new');
  const wantReview = active.includes('review');
  const wantUntranslated = active.includes('untranslated');
  const wantTranslated = active.includes('translated');
  const wantAi = active.includes('ai');
  const wantManual = active.includes('manual');
  const statusOn = wantUntranslated || wantTranslated;
  const originOn = wantAi || wantManual;
  return items.filter((item) => {
    const isTranslated = item.status !== 'untranslated';
    if (wantNew && !item.sourceChange) return false;
    if (wantReview && item.status !== 'needs_review') return false;
    if (statusOn && !((wantUntranslated && !isTranslated) || (wantTranslated && isTranslated))) return false;
    if (originOn) {
      if (!isTranslated) return false;
      const isAi = item.translationSource === 'ai';
      if (!((wantAi && isAi) || (wantManual && !isAi))) return false;
    }
    return true;
  });
}

/** How many strings each filter could show on its own; a filter with 0 can't be switched on. */
export function quickFilterCounts(items: ResourceItem[]): Record<QuickFilterId, number> {
  const counts: Record<QuickFilterId, number> = { new: 0, review: 0, untranslated: 0, translated: 0, ai: 0, manual: 0 };
  for (const item of items) {
    if (item.sourceChange) counts.new++;
    if (item.status === 'needs_review') counts.review++;
    if (item.status === 'untranslated') {
      counts.untranslated++;
      continue;
    }
    counts.translated++;
    if (item.translationSource === 'ai') counts.ai++;
    else counts.manual++;
  }
  return counts;
}
