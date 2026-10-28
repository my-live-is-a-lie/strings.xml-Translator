import React from 'react';
import { ResourceItem } from '../types';
import { DiffSegment, diffWords } from '../utils/textDiff';

function Segments({ segs }: { segs: DiffSegment[] }) {
  return (
    <>
      {segs.map((s, i) =>
        s.kind === 'same' ? (
          <span key={i}>{s.text}</span>
        ) : s.kind === 'add' ? (
          <mark key={i} className="bg-emerald-200/80 text-emerald-950 dark:bg-emerald-500/25 dark:text-emerald-100 rounded px-0.5">
            {s.text}
          </mark>
        ) : (
          <del key={i} className="bg-rose-200/80 text-rose-950 dark:bg-rose-500/25 dark:text-rose-100 rounded px-0.5 decoration-rose-500/70">
            {s.text}
          </del>
        )
      )}
    </>
  );
}

function currentSource(item: ResourceItem, key: string): string {
  if (item.type === 'string') return item.source;
  if (item.type === 'plural') return item.items.find((q) => q.quantity === key)?.source ?? '';
  return item.items.find((e) => String(e.index) === key)?.source ?? '';
}

/** Weblate-style view of how the source text changed: removed words in red, added words in green. */
export const SourceChangeDiff: React.FC<{ item: ResourceItem; isAr: boolean }> = ({ item, isAr }) => {
  const entries = Object.entries(item.previousSources ?? {});
  if (entries.length === 0) return null;
  return (
    <div
      data-source-diff
      className="rounded-lg border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/5 px-3 py-2 space-y-2 text-xs"
    >
      <p className="font-semibold text-amber-800 dark:text-amber-300">
        {isAr ? 'تغيّر نص المصدر منذ آخر ترجمة' : 'The source text changed since it was translated'}
      </p>
      {entries.map(([key, previous]) => {
        const { old, next } = diffWords(previous, currentSource(item, key));
        return (
          <div key={key} className="space-y-1">
            {key !== '' && <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{key}</p>}
            <p dir="auto" className="leading-relaxed break-words text-slate-700 dark:text-slate-200">
              <span className="font-semibold text-slate-500 dark:text-slate-400 me-1.5">{isAr ? 'قبل:' : 'Before:'}</span>
              <Segments segs={old} />
            </p>
            <p dir="auto" className="leading-relaxed break-words text-slate-700 dark:text-slate-200">
              <span className="font-semibold text-slate-500 dark:text-slate-400 me-1.5">{isAr ? 'بعد:' : 'After:'}</span>
              <Segments segs={next} />
            </p>
          </div>
        );
      })}
    </div>
  );
};

/** Small badge for the list, table and editor header. */
export const SourceChangeBadge: React.FC<{ item: ResourceItem; isAr: boolean }> = ({ item, isAr }) => {
  if (!item.sourceChange) return null;
  const added = item.sourceChange === 'added';
  return (
    <span
      data-source-change={item.sourceChange}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold border shrink-0 ms-1 ${
        added
          ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30'
          : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
      }`}
    >
      {added ? (isAr ? 'جديد' : 'New') : isAr ? 'معدّل' : 'Updated'}
    </span>
  );
};
