import React, { useRef } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { SPLIT_MAX, SPLIT_MIN } from '../hooks/useLandscapeSplit';

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** True when the info half sits on the physical left side of the screen. */
  infoOnLeft: boolean;
  onRatioChange: (ratio: number) => void;
  onSwap: () => void;
  isAr: boolean;
}

/** Vertical divider with a handle at its top: drag to resize (limited to ±15%), tap to swap the halves. */
export const SplitDivider: React.FC<Props> = ({ containerRef, infoOnLeft, onRatioChange, onSwap, isAr }) => {
  const start = useRef<{ x: number; moved: boolean } | null>(null);

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    start.current = { x: e.clientX, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!s || !box || box.width === 0) return;
    if (!s.moved && Math.abs(e.clientX - s.x) < 8) return;
    s.moved = true;
    const fromLeft = (e.clientX - box.left) / box.width;
    const ratio = infoOnLeft ? fromLeft : 1 - fromLeft;
    onRatioChange(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio)));
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (s && !s.moved) onSwap(); // a single tap flips the halves
  };

  return (
    <div className="relative w-px shrink-0 bg-slate-300 dark:bg-slate-700 z-20" aria-hidden={false}>
      <button
        type="button"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (start.current = null)}
        title={isAr ? 'اسحب لتغيير العرض، انقر لعكس الجانبين' : 'Drag to resize, tap to swap sides'}
        aria-label={isAr ? 'فاصل الشاشة' : 'Split divider'}
        className="absolute top-3 left-1/2 -translate-x-1/2 w-9 h-14 rounded-full bg-slate-200 dark:bg-[#232C3A] border border-slate-300 dark:border-slate-600 shadow-md flex items-center justify-center text-slate-600 dark:text-slate-300 touch-none cursor-col-resize select-none"
      >
        <ArrowLeftRight className="w-4 h-4" />
      </button>
    </div>
  );
};
