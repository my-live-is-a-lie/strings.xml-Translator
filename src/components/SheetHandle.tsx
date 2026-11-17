import { useEffect, useRef } from 'react';

interface SheetHandleProps {
  onClose: () => void;
  /** Distance (px) after which letting go closes the window. */
  threshold?: number;
}

const EXIT_MS = 200;

/**
 * Pill at the bottom of a dialog. Drag it upwards like the Android "home" gesture: the dialog follows the
 * finger, shrinks and fades; letting go far enough (or with a quick flick) closes it, otherwise it springs back.
 * The dialog is the closest `[role="dialog"]` ancestor and its parent is treated as the dimmed backdrop.
 */
export function SheetHandle({ onClose, threshold = 110 }: SheetHandleProps) {
  const drag = useRef<{ id: number; startY: number; lastY: number; lastT: number; velocity: number; dy: number } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const parts = (el: HTMLElement) => {
    const card = el.closest<HTMLElement>('[role="dialog"]');
    return card ? { card, backdrop: card.parentElement } : null;
  };

  const paint = (el: HTMLElement, dy: number, animate: boolean) => {
    const p = parts(el);
    if (!p) return;
    const progress = Math.min(1, dy / Math.max(1, window.innerHeight * 0.6));
    const transition = animate ? `transform ${EXIT_MS}ms ease-out, opacity ${EXIT_MS}ms ease-out` : 'none';
    p.card.style.transition = transition;
    p.card.style.transformOrigin = '50% 100%';
    p.card.style.transform = dy > 0 ? `translateY(${-dy}px) scale(${1 - progress * 0.4})` : '';
    p.card.style.opacity = dy > 0 ? String(1 - progress * 0.6) : '';
    if (p.backdrop) {
      p.backdrop.style.transition = animate ? `opacity ${EXIT_MS}ms ease-out` : 'none';
      p.backdrop.style.opacity = dy > 0 ? String(Math.max(0, 1 - Math.min(1, dy / 320))) : '';
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, dy: 0 };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.velocity = (d.lastY - e.clientY) / dt; // px/ms, positive = upwards
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    d.dy = Math.max(0, d.startY - e.clientY);
    paint(e.currentTarget, d.dy, false);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    const flick = d.velocity > 0.5 && d.dy > 30;
    if (!cancelled && (d.dy >= threshold || flick)) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        onClose();
        return;
      }
      paint(el, window.innerHeight, true);
      timer.current = window.setTimeout(onClose, EXIT_MS);
    } else {
      paint(el, 0, true);
    }
  };

  return (
    <div
      role="presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      style={{ touchAction: 'none' }}
      className="flex items-center justify-center h-9 cursor-grab active:cursor-grabbing select-none shrink-0"
    >
      <span className="block w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
    </div>
  );
}
