import { SourceChangeBadge } from './SourceChangeDiff';
import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { scrollItemIntoView } from '../utils/scrollToItem';
import { ResourceItem, FilterStatus, SourceFilter, SingleStringItem } from '../types';
import { breakAfterUnderscores } from './keyBreaks';
import { Search, CheckCircle2, AlertCircle, Check, Sparkles, CheckSquare, Square, Loader2, ChevronDown, ChevronUp, ArrowUpDown, ArrowUp } from 'lucide-react';
import { bulkTranslateItems, withTranslationProvider } from '../utils/translator';
import { BulkProviderModal, EXTERNAL_AI_PROVIDER_ID } from './BulkProviderModal';
import { ExternalAiModal } from './ExternalAiModal';
import { filterProjectItems } from '../utils/xmlExporter';
import { applyQuickSnapshot, clearAllQuickFilters, toggleQuickFilter, useQuickFilters, QuickFilterId } from '../utils/quickFilters';
import { getLanguageOption } from '../utils/languages';
import { useT } from '../i18n/i18n';

interface TableViewProps {
  items: ResourceItem[];
  /** The string currently open in the editor: the table opens on its page and scrolls to it. */
  selectedId?: string;
  onSelectString: (id: string) => void;
  onUpdateTranslation: (updated: ResourceItem) => void;
  targetLang?: string;
  targetLocaleName?: string;
  appLang?: 'ar' | 'en';
  onBulkUpdateTranslations?: (updatedItems: ResourceItem[]) => void;
  onResetItemHistory?: (id: string) => void;
  filterStatus?: FilterStatus;
  onFilterChange?: (status: FilterStatus) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  sourceFilter?: SourceFilter;
  /** Counts line (translated / untranslated): shown above the search and hidden together with it while scrolling down. */
  statsNode?: React.ReactNode;
}

// Windowed list: strings are loaded in chunks near the edges and trimmed on the far side.
const CHUNK = 40;
const MAX_RENDERED = 120;
const PRELOAD_PX = 700;
const EST_HEIGHT = 120;

// Wrapped with React.memo below: re-renders only when its props change
const TableViewBase: React.FC<TableViewProps> = ({
  items,
  onSelectString,
  onUpdateTranslation,
  targetLang = 'ar',
  targetLocaleName,
  appLang = 'ar',
  onBulkUpdateTranslations,
  onResetItemHistory: _onResetItemHistory,
  selectedId,
  searchQuery: controlledSearch,
  onSearchChange,
  statsNode,
}) => {
  const { t } = useT();
  const isAr = appLang === 'ar';
  const [localSearch, setLocalSearch] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isBulkTranslating, setIsBulkTranslating] = useState(false);
  const [expandChoice, setExpandChoice] = useState<Record<string, boolean>>({});
  // Rows whose key name is shown in full instead of cut with an ellipsis
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);

  const search = controlledSearch !== undefined ? controlledSearch : localSearch;
  const setSearch = (q: string) => {
    if (onSearchChange) onSearchChange(q);
    else setLocalSearch(q);
  };



  const quickFilters = useQuickFilters();
  const quickActive = quickFilters.active;
  // Length sort: off -> shortest first -> longest first -> off
  const [sortMode, setSortMode] = useState<'none' | 'asc' | 'desc'>('none');
  // 'toggle' = switching on or off, 'flip' = switching between shortest/longest first (own animation timing)
  const [sortSwitch, setSortSwitch] = useState<'toggle' | 'flip'>('toggle');
  const cycleSort = () => {
    setSortSwitch(sortMode === 'asc' ? 'flip' : 'toggle');
    setSortMode(sortMode === 'none' ? 'asc' : sortMode === 'asc' ? 'desc' : 'none');
  };
  // Strings edited here stay in the list until the search/filter changes, even when the edit no longer matches the
  // filter (typing one letter in an untranslated string makes it "translated", and it must not vanish mid-typing).
  const [stickyIds, setStickyIds] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => {
    const matched = applyQuickSnapshot(filterProjectItems(items, 'all', search, 'all'), quickFilters);
    let base = matched;
    if (stickyIds.size > 0) {
      const have = new Set(matched.map((i) => i.id));
      if (Array.from(stickyIds).some((id) => !have.has(id))) {
        base = items.filter((i) => have.has(i.id) || stickyIds.has(i.id));
      }
    }
    if (sortMode === 'none') return base;
    // Size of a string = its source text length plus the number of variants (plural forms / array elements)
    const size = (it: ResourceItem) =>
      it.type === 'string'
        ? (it.source || '').length
        : (it.items || []).reduce((n, v) => n + (v.source || '').length, 0);
    const count = (it: ResourceItem) => (it.type === 'string' ? 1 : (it.items || []).length);
    const dir = sortMode === 'asc' ? 1 : -1;
    return base
      .map((it, idx) => ({ it, idx, size: size(it), count: count(it) }))
      .sort((a, b) => dir * (a.size - b.size || a.count - b.count) || a.idx - b.idx)
      .map((x) => x.it);
  }, [items, search, quickFilters, sortMode, stickyIds]);

  const total = filtered.length;
  const [win, setWin] = useState(() => {
    const idx = selectedId ? filtered.findIndex((i) => i.id === selectedId) : -1;
    const start = idx > 0 ? Math.max(0, idx - Math.floor(CHUNK / 2)) : 0;
    return { start, end: start + CHUNK };
  });
  const tableRootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const anchorRef = useRef<{ id: string; top: number } | null>(null);
  const lastTopRef = useRef(0);
  // True while the table is auto-centring the selected string on open: that programmatic scroll
  // shouldn't trigger the "hide the top block on scroll down" behavior in handleScroll below,
  // or the header flashes and immediately disappears as soon as the table opens.
  const suppressHeaderToggleRef = useRef(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [headerH, setHeaderH] = useState(0);

  useEffect(() => {
    const root = tableRootRef.current;
    if (!selectedId || !root) return;
    suppressHeaderToggleRef.current = true;
    scrollItemIntoView(root, selectedId, 'center');
    // Row heights are measured after the first paint and shift what is above the string: centre it again once they settle
    const timer = window.setTimeout(() => scrollItemIntoView(root, selectedId, 'center'), 120);
    const release = window.setTimeout(() => {
      suppressHeaderToggleRef.current = false;
    }, 250);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once, when the table opens
  }, []);
  // Back to the top of the list and closing the editor when the search or filters change (during render)
  const viewKey = `${search}|${quickActive.join(',')}|${sortMode}`;
  const [lastViewKey, setLastViewKey] = useState(viewKey);
  if (lastViewKey !== viewKey) {
    setLastViewKey(viewKey);
    setWin({ start: 0, end: CHUNK });
    setEditingId(null);
  }
  const filterKey = `${search}|${quickActive.join(',')}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setStickyIds(new Set());
  }
  const firstViewKey = useRef(true);
  useEffect(() => {
    if (firstViewKey.current) {
      firstViewKey.current = false;
      return;
    }
    anchorRef.current = null;
    scrollRef.current?.scrollTo({ top: 0 });
    lastTopRef.current = 0;
    setHeaderHidden(false);
  }, [viewKey]);

  const end = Math.min(win.end, total);
  const start = Math.min(win.start, end);
  const pagedItems = useMemo(() => filtered.slice(start, end), [filtered, start, end]);

  // After every render: remember the real height of each rendered string, size the spacers that stand in for the
  // strings that are not rendered, and keep the string the reader is looking at in place when the window changed.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const heights = heightsRef.current;
    root.querySelectorAll<HTMLElement>('[data-item-id]').forEach((el) => {
      if (el.offsetParent === null) return;
      const h = el.getBoundingClientRect().height;
      if (h > 0 && el.dataset.itemId) heights.set(el.dataset.itemId, h);
    });
    let sum = 0;
    heights.forEach((h) => {
      sum += h;
    });
    const avg = heights.size ? sum / heights.size : EST_HEIGHT;
    const spaceFor = (from: number, to: number) => {
      let space = 0;
      for (let i = from; i < to; i++) space += heights.get(filtered[i].id) ?? avg;
      return space;
    };
    const topSpace = spaceFor(0, start);
    const bottomSpace = spaceFor(end, total);
    root.querySelectorAll<HTMLElement>('[data-spacer="top"]').forEach((el) => {
      el.style.height = `${topSpace}px`;
    });
    root.querySelectorAll<HTMLElement>('[data-spacer="bottom"]').forEach((el) => {
      el.style.height = `${bottomSpace}px`;
    });

    const a = anchorRef.current;
    if (a) {
      anchorRef.current = null;
      const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(a.id) : a.id.replace(/"/g, '\\"');
      const el = Array.from(root.querySelectorAll<HTMLElement>(`[data-item-id="${safe}"]`)).find(
        (n) => n.offsetParent !== null
      );
      if (el) {
        const delta = el.getBoundingClientRect().top - a.top;
        if (Math.abs(delta) > 0.5) root.scrollTop += delta;
      }
      lastTopRef.current = root.scrollTop;
    }
  });

  // The collapsing top block overlays the list, so its height is the list's top padding
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    setHeaderH(el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const captureAnchor = () => {
    const root = scrollRef.current;
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const nodes = root.querySelectorAll<HTMLElement>('[data-item-id]');
    for (const el of Array.from(nodes)) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > rootTop + 1 && el.dataset.itemId) {
        anchorRef.current = { id: el.dataset.itemId, top: r.top };
        return;
      }
    }
  };

  const handleScroll = () => {
    const root = scrollRef.current;
    if (!root) return;
    const top = root.scrollTop;
    const delta = top - lastTopRef.current;
    lastTopRef.current = top;

    // Scrolling down hides the top block, scrolling up brings it back (not during the
    // programmatic auto-centring scroll on open, see suppressHeaderToggleRef above)
    if (!suppressHeaderToggleRef.current) {
      if (top <= 8) setHeaderHidden(false);
      else if (delta > 4) setHeaderHidden(true);
      else if (delta < -4) setHeaderHidden(false);
    }

    // Where the rendered strings begin and end, in scroll-content coordinates (spacers stand in for the rest)
    const rootRect = root.getBoundingClientRect();
    const visible = (kind: 'top' | 'bottom') =>
      Array.from(root.querySelectorAll<HTMLElement>(`[data-spacer="${kind}"]`)).find((el) => el.offsetParent !== null);
    const topSpacer = visible('top');
    const bottomSpacer = visible('bottom');
    if (!topSpacer || !bottomSpacer) return;
    const renderedStartY = topSpacer.getBoundingClientRect().bottom - rootRect.top + top;
    const renderedEndY = bottomSpacer.getBoundingClientRect().top - rootRect.top + top;
    const viewTop = top;
    const viewBottom = top + root.clientHeight;

    // Scrolled far into the blank estimate (fast fling): jump the window to where the viewport is
    const recenter = () => {
      const heights = heightsRef.current;
      let sum = 0;
      heights.forEach((h) => {
        sum += h;
      });
      const avg = heights.size ? sum / heights.size : EST_HEIGHT;
      const target = Math.max(0, viewTop - headerH - 12);
      let acc = 0;
      let idx = 0;
      while (idx < total - 1) {
        const h = heights.get(filtered[idx].id) ?? avg;
        if (acc + h > target) break;
        acc += h;
        idx += 1;
      }
      anchorRef.current = null;
      const newStart = Math.max(0, Math.min(idx - 10, total - 1));
      setWin({ start: newStart, end: Math.min(total, newStart + CHUNK + 10) });
    };

    if (viewBottom > renderedEndY - PRELOAD_PX && end < total) {
      if (viewTop > renderedEndY) {
        recenter();
      } else {
        // Near the end: load more strings below and drop the oldest ones above
        captureAnchor();
        setWin((w) => {
          const newEnd = Math.min(total, w.end + CHUNK);
          const newStart = newEnd - w.start > MAX_RENDERED ? newEnd - MAX_RENDERED : w.start;
          return { start: newStart, end: newEnd };
        });
      }
    } else if (viewTop < renderedStartY + PRELOAD_PX && start > 0 && delta <= 0) {
      if (viewBottom < renderedStartY) {
        recenter();
      } else {
        // Back near the start of the loaded part: reload the earlier strings and drop the ones far below
        captureAnchor();
        setWin((w) => {
          const newStart = Math.max(0, w.start - CHUNK);
          const newEnd = w.end - newStart > MAX_RENDERED ? newStart + MAX_RENDERED : w.end;
          return { start: newStart, end: newEnd };
        });
      }
    }
  };

  const filteredUntranslated = useMemo(() => filtered.filter((i) => i.status === 'untranslated'), [filtered]);
  const allPagedSelected = pagedItems.length > 0 && pagedItems.every((i) => checkedIds.has(i.id));
  const allFilteredUntranslatedSelected =
    filteredUntranslated.length > 0 && filteredUntranslated.every((i) => checkedIds.has(i.id));

  const toggleItemChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAllPaged = () => {
    if (allPagedSelected) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        pagedItems.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        pagedItems.forEach((i) => next.add(i.id));
        return next;
      });
    }
  };

  const handleToggleSelectUntranslated = () => {
    if (allFilteredUntranslatedSelected) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filteredUntranslated.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filteredUntranslated.forEach((i) => next.add(i.id));
        return next;
      });
    }
  };

  const [chooseProviderOpen, setChooseProviderOpen] = useState(false);
  const handleBulkTranslate = () => {
    if (checkedIds.size === 0 || isBulkTranslating || !onBulkUpdateTranslations) return;
    setChooseProviderOpen(true);
  };

  const [externalAiOpen, setExternalAiOpen] = useState(false);
  const runBulkTranslate = async (providerId: string) => {
    setChooseProviderOpen(false);
    if (providerId === EXTERNAL_AI_PROVIDER_ID) {
      setExternalAiOpen(true);
      return;
    }
    if (checkedIds.size === 0 || isBulkTranslating || !onBulkUpdateTranslations) return;
    const selectedItems = items.filter((i) => checkedIds.has(i.id));
    if (selectedItems.length === 0) return;

    setIsBulkTranslating(true);
    setBulkProgress({ completed: 0, total: selectedItems.length });

    try {
      const translatedItems = await withTranslationProvider(providerId, () =>
        bulkTranslateItems(selectedItems, targetLang, targetLocaleName, (completed, total) => {
          setBulkProgress({ completed, total });
        })
      );
      onBulkUpdateTranslations(translatedItems);
      setCheckedIds(new Set());
    } finally {
      setIsBulkTranslating(false);
      setBulkProgress(null);
    }
  };

  const highlightText = (text: string, q: string): React.ReactNode => {
    if (!q) return text;
    const lower = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let i = 0;
    while (true) {
      const idx = lower.indexOf(q, i);
      if (idx === -1) break;
      if (idx > i) parts.push(text.slice(i, idx));
      parts.push(
        <mark key={idx} className="rounded px-0.5 bg-amber-300/70 dark:bg-amber-400/30 text-inherit">
          {text.slice(idx, idx + q.length)}
        </mark>
      );
      i = idx + q.length;
    }
    parts.push(text.slice(i));
    return parts;
  };

  const mobileTargetClass =
    'w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none transition';

  const QUANTITY_STYLES: Record<string, string> = {
    zero: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
    one: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    two: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    few: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    many: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    other: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  };

  // One entry per plural form / array element, so each can be shown on its own line.
  const getVariants = (item: ResourceItem) => {
    if (item.type === 'plural') {
      return (item.items || []).map((i) => ({ label: String(i.quantity), source: i.source || '', target: i.target || '' }));
    }
    if (item.type === 'array') {
      return (item.items || []).map((i) => ({ label: String(i.index), source: i.source || '', target: i.target || '' }));
    }
    return [];
  };

  const renderVariantBadge = (label: string) => (
    <span
      className={`shrink-0 inline-flex items-center justify-center min-w-[2.75rem] px-1.5 py-0.5 rounded-md font-mono text-[10px] font-semibold leading-none ${
        QUANTITY_STYLES[label] ?? 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300'
      }`}
    >
      {label}
    </span>
  );

  // Table cells: one line per variant, badge + text.
  const renderVariantLines = (item: ResourceItem, side: 'source' | 'target') => (
    <div className="space-y-1.5">
      {getVariants(item).map((v) => {
        const text = side === 'source' ? v.source : v.target;
        return (
          <div key={v.label} className="flex items-start gap-2">
            {renderVariantBadge(v.label)}
            <span
              dir={side === 'source' ? 'ltr' : 'auto'}
              className={
                side === 'source'
                  ? 'text-left'
                  : text
                    ? 'text-emerald-700 dark:text-emerald-300 font-medium'
                    : 'text-slate-400 italic'
              }
            >
              {text || (side === 'target' ? (t('untranslated')) : '')}
            </span>
          </div>
        );
      })}
    </div>
  );

  const getSnippets = (item: ResourceItem) => {
    let sourceSnippet = '';
    let targetSnippet = '';
    if (item.type === 'string') {
      sourceSnippet = item.source || '';
      targetSnippet = item.target || '';
    } else if (item.type === 'plural') {
      sourceSnippet = (item.items || []).map((i) => `[${i.quantity}] ${i.source || ''}`).join('; ');
      targetSnippet = (item.items || []).map((i) => `[${i.quantity}] ${i.target || '—'}`).join('; ');
    } else if (item.type === 'array') {
      sourceSnippet = (item.items || []).map((i) => `[${i.index}] ${i.source || ''}`).join('; ');
      targetSnippet = (item.items || []).map((i) => `[${i.index}] ${i.target || '—'}`).join('; ');
    }
    return { sourceSnippet, targetSnippet };
  };

  const targetIsRtl = !!getLanguageOption(targetLang).isRtl;

  const renderTarget = (
    item: ResourceItem,
    targetSnippet: string,
    inputClassName: string,
    multiline = false,
    onFocus?: () => void,
    autoFocus = false
  ) => {
    if (item.type !== 'string') {
      return (
        <span
          className={
            targetSnippet ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-slate-400 italic'
          }
        >
          {targetSnippet || (t('untranslated'))}
        </span>
      );
    }
    const value = (item as SingleStringItem).target;
    const commonProps = {
      // Empty fields follow the target language's direction so the caret and placeholder start on the right side for Arabic.
      dir: (value ? 'auto' : targetIsRtl ? 'rtl' : 'ltr') as 'auto' | 'rtl' | 'ltr',
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const val = e.target.value;
        setStickyIds((prev) => (prev.has(item.id) ? prev : new Set(prev).add(item.id)));
        onUpdateTranslation({
          ...item,
          target: val,
          status: val.trim() ? 'translated' : 'untranslated',
          translationSource: val.trim() ? 'manual' : undefined,
        });
      },
      placeholder: t('type_translation'),
      className: inputClassName,
    };
    // Multi-line (mobile cards): grows with the text so long translations are fully readable.
    return multiline ? (
      <textarea
        {...commonProps}
        onFocus={onFocus}
        autoFocus={autoFocus}
        rows={Math.min(8, Math.max(1, Math.ceil(value.length / 34)))}
        className={`${inputClassName} resize-none field-sizing-content leading-relaxed`}
      />
    ) : (
      <input type="text" {...commonProps} />
    );
  };

  const renderStatusIcon = (item: ResourceItem) =>
    item.status === 'translated' ? (
      <CheckCircle2 className="w-4 h-4 mx-auto text-emerald-600 dark:text-emerald-400" />
    ) : item.status === 'needs_review' ? (
      <AlertCircle className="w-4 h-4 mx-auto text-amber-600 dark:text-amber-400" />
    ) : null;

  const sortButton = (
    <button
                id="table-sort-length-btn"
                type="button"
                onClick={cycleSort}
                aria-pressed={sortMode !== 'none'}
                className={`${isAr ? 'ms-auto ' : 'me-auto '}inline-grid place-items-center w-8 h-8 rounded-full border transition-colors duration-200 cursor-pointer ${
                  sortMode === 'none'
                    ? 'border-transparent bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                    : 'bg-transparent border-current text-[#0B57D0] dark:text-[#D3E3FD]'
                }`}
                title={
                  sortMode === 'none'
                    ? t('sort_by_length_off')
                    : sortMode === 'asc'
                      ? t('shortest_first')
                      : t('longest_first')
                }
                aria-label={t('sort_by_length')}
              >
                {/* Both icons stay mounted so switching on/off springs one in and the other out */}
                <ArrowUpDown
                  className="col-start-1 row-start-1 w-4 h-4"
                  style={{
                    opacity: sortMode === 'none' ? 1 : 0,
                    transform: sortMode === 'none' ? 'rotate(0deg) scale(1)' : 'rotate(90deg) scale(0.4)',
                    transition: 'transform 320ms cubic-bezier(0.34, 1.25, 0.64, 1), opacity 200ms ease',
                  }}
                />
                {/* One bold arrow: up = shortest first; it springs round to point down for longest first */}
                <ArrowUp
                  className="col-start-1 row-start-1 w-5 h-5"
                  strokeWidth={3}
                  style={{
                    opacity: sortMode === 'none' ? 0 : 0.7,
                    transform:
                      sortMode === 'none'
                        ? 'rotate(-90deg) scale(0.4)'
                        : sortMode === 'desc'
                          ? 'rotate(180deg) scale(1)'
                          : 'rotate(0deg) scale(1)',
                    transition:
                      sortSwitch === 'toggle'
                        ? 'transform 340ms cubic-bezier(0.34, 1.25, 0.64, 1), opacity 200ms ease'
                        : 'transform 520ms cubic-bezier(0.34, 1.7, 0.64, 1), opacity 250ms ease',
                  }}
                />
              </button>
  );

  return (
    <div ref={tableRootRef} className="tv-bg flex flex-col h-full bg-white dark:bg-[#121318] overflow-hidden">
      {externalAiOpen && (
        <ExternalAiModal
          items={items.filter((i) => checkedIds.has(i.id))}
          reviewPool={items}
          targetLang={targetLang ?? 'ar'}
          targetLocaleName={targetLocaleName}
          appLang={appLang}
          onClose={() => setExternalAiOpen(false)}
          onApply={(applied) => {
            onBulkUpdateTranslations?.(applied);
            setCheckedIds(new Set());
          }}
        />
      )}
      {chooseProviderOpen && (
        <BulkProviderModal
          count={checkedIds.size}
          appLang={appLang}
          onClose={() => setChooseProviderOpen(false)}
          onConfirm={runBulkTranslate}
        />
      )}
      <div className="relative flex-1 min-h-0 overflow-hidden">
      {/* Top block (counts, search, filters): slides away on scroll down, returns on scroll up */}
      <div
        ref={headerRef}
        className="tv-bg absolute top-0 inset-x-0 z-20 bg-white dark:bg-[#121318] transition-transform duration-200 ease-out will-change-transform"
        style={{ transform: headerHidden ? 'translateY(-100%)' : 'translateY(0)' }}
      >
      {statsNode}
      {/* Search, Filter & Bulk Actions Header */}
      <div className="tv-bg p-4 sm:p-5 border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-[#121318] flex flex-wrap items-center justify-between gap-3">
        {/* M3 Search Bar */}
        <div className="relative flex-1 min-w-[240px] max-w-md flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-full px-4 py-2 ring-1 ring-slate-200/60 dark:ring-slate-700/60 focus-within:ring-2 focus-within:ring-[#0B57D0] dark:focus-within:ring-[#A8C7FA] focus-within:bg-white dark:focus-within:bg-[#1E1F20] transition-all">
          <Search className="w-4 h-4 text-slate-600 dark:text-slate-400 me-2.5 shrink-0" />
          <input
            id="table-search-input"
            type="text"
            placeholder={t('search_all_strings_by_key')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Bulk Selection & AI Translation Controls */}
          {onBulkUpdateTranslations && (
            <div className="flex w-full md:w-auto items-center gap-1.5 text-xs">
              {!isAr && sortButton}
              <button
                id="table-select-untranslated-btn"
                type="button"
                onClick={handleToggleSelectUntranslated}
                disabled={filteredUntranslated.length === 0 || isBulkTranslating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                title={t('select_all_untranslated_strings_in')}
              >
                {allFilteredUntranslatedSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span data-i18n>
                  {t('select_untranslated', filteredUntranslated.length)}
                </span>
              </button>


              {checkedIds.size > 0 && (
                <button
                  id="table-bulk-translate-btn"
                  type="button"
                  onClick={handleBulkTranslate}
                  disabled={isBulkTranslating}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#1EB996] hover:bg-[#19A585] text-white font-semibold shadow-xs transition cursor-pointer disabled:opacity-60"
                >
                  {isBulkTranslating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>
                        {bulkProgress
                          ? t('translating_2', bulkProgress.completed, bulkProgress.total)
                          : t('translating')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span data-i18n>
                        {t('bulk_translate', checkedIds.size)}
                      </span>
                    </>
                  )}
                </button>
              )}
              {isAr && sortButton}
              
            </div>
          )}

          {/* M3 Filter Chips */}
          <div className="flex items-center gap-1.5 text-xs overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: t('all') },
                { id: 'untranslated', label: t('untranslated') },
                { id: 'translated', label: t('done_2') },
                { id: 'review', label: t('review') },
                // Shown only while it is switched on from the editor
                ...(quickActive.includes('new') ? [{ id: 'new', label: isAr ? 'جديد' : 'New' }] : []),
                ...(quickActive.includes('ai') ? [{ id: 'ai', label: isAr ? 'ذكاء اصطناعي' : 'AI' }] : []),
                ...(quickActive.includes('manual') ? [{ id: 'manual', label: isAr ? 'يدوي' : 'Manual' }] : []),
                ...(quickActive.includes('plural') ? [{ id: 'plural', label: isAr ? 'صيغ الجمع' : 'Plurals' }] : []),
                ...(quickActive.includes('array') ? [{ id: 'array', label: isAr ? 'المصفوفات' : 'Arrays' }] : []),
              ] as const
            ).map((st) => {
              const isSelected = st.id === 'all' ? quickActive.length === 0 : quickActive.includes(st.id as QuickFilterId);
              return (
                <button
                  key={st.id}
                  onClick={() => (st.id === 'all' ? clearAllQuickFilters(items) : toggleQuickFilter(st.id as QuickFilterId, items))}
                  className={`inline-flex shrink-0 whitespace-nowrap items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium capitalize transition cursor-pointer m3-state-layer ${
                    isSelected
                      ? 'bg-[#D3E3FD] text-[#041E49] dark:bg-[#0842A0] dark:text-[#D3E3FD]'
                      : 'bg-transparent text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                  <span>{st.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      </div>

      {/* Table Container */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-auto px-4 pb-4 sm:px-6 sm:pb-6"
        style={{ paddingTop: headerH + 12, overflowAnchor: 'none' }}
      >
        <div className="tv-bg bg-white dark:bg-[#121318] rounded-2xl overflow-hidden">
          {/* Mobile: one stacked card per string (the 6-column table is too wide for phones) */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/60">
            {filtered.length === 0 ? (
              <div data-i18n className="py-16 text-center text-slate-400 text-xs">
                {t('no_strings_match_the_filter')}
              </div>
            ) : (
              <>
              <div aria-hidden="true" data-spacer="top" style={{ borderTopWidth: 0 }} />
              {pagedItems.map((item) => {
                const isChecked = checkedIds.has(item.id);
                const { sourceSnippet, targetSnippet } = getSnippets(item);
                const q = search.trim().toLowerCase();
                const variants = getVariants(item);
                const isLong =
                  item.type === 'string'
                    ? sourceSnippet.length > 110 || targetSnippet.length > 110
                    : variants.length > 2;
                const matchInText =
                  !!q && (sourceSnippet.toLowerCase().includes(q) || targetSnippet.toLowerCase().includes(q));
                // A search hit inside long text opens the card automatically (unless the user chose otherwise).
                const expanded = !isLong || (expandChoice[item.id] ?? matchInText);
                const setExpanded = (v: boolean) => setExpandChoice((prev) => ({ ...prev, [item.id]: v }));
                return (
                  <div
                    key={item.id}
                    data-item-id={item.id}
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    className={`p-3.5 space-y-2.5 ${
                      item.id === selectedId
                        ? 'rounded-2xl bg-[#E8F0FE] dark:bg-[#1E293B] ring-1 ring-inset ring-[#0B57D0]/30 dark:ring-[#A8C7FA]/30'
                        : isChecked
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                          : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {/* The checkbox and the status (completion) icon both sit on the physical right in
                          both directions: they render here (before the key) in RTL, where that's already
                          the right side, and after the key (see below) in LTR instead of always being first. */}
                      {onBulkUpdateTranslations && isAr && (
                        <button
                          type="button"
                          onClick={() => toggleItemChecked(item.id)}
                          disabled={isBulkTranslating}
                          className="shrink-0 inline-flex items-center justify-center text-slate-400 cursor-pointer"
                          title={t('select_row_for_bulk_translation')}
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-[#1EB996]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      {isAr && <span className="shrink-0">{renderStatusIcon(item)}</span>}
                      <SourceChangeBadge item={item} isAr={isAr} />
                      <span
                        dir="ltr"
                        data-key-name
                        onClick={() => onSelectString(item.id)}
                        title={t('open_in_translation_editor')}
                        className={`flex-1 min-w-0 font-mono text-xs text-start cursor-pointer break-words ${
                          item.id === selectedId
                            ? 'font-semibold text-[#0B57D0] dark:text-[#A8C7FA]'
                            : 'font-medium text-slate-900 dark:text-slate-100'
                        }`}

                      >
                        {breakAfterUnderscores(item.name)}
                        {item.type !== 'string' && (
                          <span className="ms-1 text-[10px] text-slate-600 dark:text-slate-400 font-sans">
                            ({isAr ? (item.type === 'plural' ? 'جمع' : 'مصفوفة') : item.type})
                          </span>
                        )}
                      </span>
                      {!isAr && <span className="shrink-0">{renderStatusIcon(item)}</span>}
                      {onBulkUpdateTranslations && !isAr && (
                        <button
                          type="button"
                          onClick={() => toggleItemChecked(item.id)}
                          disabled={isBulkTranslating}
                          className="shrink-0 inline-flex items-center justify-center text-slate-400 cursor-pointer"
                          title={t('select_row_for_bulk_translation')}
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-[#1EB996]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>

                    {item.type !== 'string' ? (
                      <div className="space-y-2.5">
                        {(expanded ? variants : variants.slice(0, 2)).map((v) => (
                          <div key={v.label} className="flex items-start gap-2.5">
                            {renderVariantBadge(v.label)}
                            <div className="min-w-0 flex-1 space-y-0.5 text-xs leading-relaxed">
                              <p
                                onClick={isLong ? () => setExpanded(!expanded) : undefined}
                                dir={item.status === 'untranslated' ? 'ltr' : targetIsRtl ? 'rtl' : 'ltr'}
                                className={`${item.status === 'untranslated' || !targetIsRtl ? 'text-left' : 'text-right'} text-slate-600 dark:text-slate-400 break-words ${isLong ? 'cursor-pointer' : ''}`}
                              >
                                <bdi>{highlightText(v.source, q)}</bdi>
                              </p>
                              <p
                                className={`break-words ${
                                  v.target ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-slate-400 italic'
                                }`}
                              >
                                <bdi>{v.target ? highlightText(v.target, q) : t('untranslated')}</bdi>
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                    <p
                      onClick={isLong ? () => setExpanded(!expanded) : undefined}
                      data-src-toggle
                      dir={item.status === 'untranslated' ? 'ltr' : targetIsRtl ? 'rtl' : 'ltr'}
                      className={`${item.status === 'untranslated' || !targetIsRtl ? 'text-left' : 'text-right'} text-xs leading-relaxed text-slate-600 dark:text-slate-400 break-words whitespace-pre-wrap ${
                        expanded ? '' : 'line-clamp-3'
                      } ${isLong ? 'cursor-pointer' : ''}`}
                    >
                      <bdi>{highlightText(sourceSnippet, q)}</bdi>
                    </p>

                    <div className={`text-xs ${item.type !== 'string' && !expanded ? 'line-clamp-3' : ''} ${item.type === 'string' && !(item as SingleStringItem).target && !stickyIds.has(item.id) ? 'hidden' : ''}`}>
                      {item.type === 'string' && q && targetSnippet.toLowerCase().includes(q) && editingId !== item.id ? (
                        // Search hit inside the translation: show it highlighted; tap to edit.
                        <div
                          onClick={() => setEditingId(item.id)}
                          className={`${mobileTargetClass} leading-relaxed whitespace-pre-wrap break-words cursor-text ${
                            expanded ? '' : 'line-clamp-3'
                          }`}
                        >
                          <bdi>{highlightText(targetSnippet, q)}</bdi>
                        </div>
                      ) : !(item as SingleStringItem).target && !stickyIds.has(item.id) ? null : (
                        renderTarget(
                          item,
                          targetSnippet,
                          mobileTargetClass + (expanded ? '' : ' max-h-[4.3rem] overflow-hidden'),
                          true,
                          () => isLong && setExpanded(true),
                          editingId === item.id
                        )
                      )}
                    </div>

                      </>
                    )}


                    {isLong && item.type !== 'string' && (
                      <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0B57D0] dark:text-[#A8C7FA] cursor-pointer"
                      >
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {expanded
                          ? t('show_less')
                          : item.type === 'plural'
                            ? t('show_more_2', variants.length - 2)
                            : t('show_more')}
                      </button>
                    )}
                  </div>
                );
              })}
              <div aria-hidden="true" data-spacer="bottom" style={{ borderTopWidth: 0 }} />
              </>
            )}
          </div>

          <table className="hidden md:table w-full text-start border-collapse text-xs">
            <thead className="tv-bg bg-slate-50 dark:bg-[#121318] text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200/80 dark:border-slate-800/80 uppercase tracking-wider text-[11px]">
              <tr>
                {onBulkUpdateTranslations && (
                  <th className="py-3 px-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={handleToggleSelectAllPaged}
                      disabled={pagedItems.length === 0 || isBulkTranslating}
                      className="inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer disabled:opacity-40"
                      title={t('select_all_rows_on_this')}
                    >
                      {allPagedSelected ? (
                        <CheckSquare className="w-4 h-4 text-[#1EB996]" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                )}
                <th data-i18n className="py-3 px-3 w-12 text-center">{t('status')}</th>
                <th data-i18n className="py-3 px-4 w-52">{t('key_name')}</th>
                <th data-i18n className="py-3 px-4">{t('english_source')}</th>
                <th data-i18n className="py-3 px-4">{t('target_translation')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {filtered.length === 0 ? (
                <tr>
                  <td data-i18n colSpan={onBulkUpdateTranslations ? 5 : 4} className="py-16 text-center text-slate-400 text-xs">
                    {t('no_strings_match_the_filter')}
                  </td>
                </tr>
              ) : (
                <>
                <tr aria-hidden="true" data-spacer="top" style={{ borderTopWidth: 0 }}><td colSpan={5} className="p-0" /></tr>
                {pagedItems.map((item) => {
                  const isChecked = checkedIds.has(item.id);
                  const { sourceSnippet, targetSnippet } = getSnippets(item);

                  return (
                    <tr
                      key={item.id}
                      data-item-id={item.id}
                      aria-current={item.id === selectedId ? 'true' : undefined}
                      className={`transition-colors group ${
                        item.id === selectedId
                          ? 'bg-[#E8F0FE] dark:bg-[#1E293B]'
                          : isChecked
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      {onBulkUpdateTranslations && (
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleItemChecked(item.id)}
                            disabled={isBulkTranslating}
                            className="inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                            title={t('select_row_for_bulk_translation')}
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-[#1EB996]" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                      )}
                      <td className="py-3 px-3 text-center">
                        {renderStatusIcon(item)}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span dir="ltr" onClick={() => onSelectString(item.id)} title={t('open_in_translation_editor')} className="break-words cursor-pointer hover:underline">{breakAfterUnderscores(item.name)}</span>
                          <SourceChangeBadge item={item} isAr={isAr} />
                          {item.type !== 'string' && (
                            <span className="text-[10px] text-slate-600 dark:text-slate-400 font-sans">
                              ({isAr ? (item.type === 'plural' ? 'جمع' : 'مصفوفة') : item.type})
                            </span>
                          )}
                        </div>
                      </td>
                      <td dir="ltr" className="py-3 px-4 text-left text-slate-700 dark:text-slate-300 max-w-xs sm:max-w-md break-words">
                        {item.type === 'string' ? <bdi>{sourceSnippet}</bdi> : renderVariantLines(item, 'source')}
                      </td>
                      <td className="py-3 px-4 max-w-xs sm:max-w-md break-words">
                        {item.type !== 'string'
                          ? renderVariantLines(item, 'target')
                          : renderTarget(
                          item,
                          targetSnippet,
                          'w-full px-3 py-1.5 text-xs rounded-lg bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 border border-transparent focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none transition'
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr aria-hidden="true" data-spacer="bottom" style={{ borderTopWidth: 0 }}><td colSpan={5} className="p-0" /></tr>
                </>
              )}
            </tbody>
          </table>

          {/* Loaded-range footer */}
          {filtered.length > 0 && (
            <div data-i18n className="tv-bg px-4 py-3 bg-white dark:bg-[#121318] border-t border-slate-200/80 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-400 tabular-nums text-center">
              {t('loaded_of_strings', total)}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export const TableView = React.memo(TableViewBase);
