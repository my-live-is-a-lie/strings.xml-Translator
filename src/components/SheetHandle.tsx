import { useEffect, useRef } from 'react';

interface SheetHandleProps {
  onClose: () => void;
  /** Distance (px) after which letting go closes the window. */
  threshold?: number;
}

const EXIT_MS = 130;

/**
 * Pill at the bottom of a dialog. Drag it upwards like the Android navigation-bar gesture: the dialog follows the
 * finger and shrinks into a small card (no fading); letting go far enough (or with a quick flick) closes it with a
 * short shrink-and-fly-up animation, otherwise it springs back.
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

  // Only the dimmed background fades (never the dialog itself, which is a child of it, so no `opacity` here)
  const dim = (backdrop: HTMLElement | null, factor: number, animate: boolean) => {
    if (!backdrop) return;
    backdrop.style.transition = animate ? `background-color ${EXIT_MS}ms ease-out` : 'none';
    backdrop.style.backgroundColor = factor < 1 ? `rgba(0, 0, 0, ${0.6 * factor})` : '';
    backdrop.style.backdropFilter = factor < 1 ? 'none' : '';
  };

  const paint = (el: HTMLElement, dy: number, animate: boolean) => {
    const p = parts(el);
    if (!p) return;
    const progress = Math.min(1, dy / Math.max(1, window.innerHeight * 0.5));
    p.card.style.transition = animate ? `transform ${EXIT_MS}ms ease-out` : 'none';
    p.card.style.transformOrigin = '50% 100%';
    p.card.style.transform = dy > 0 ? `translateY(${-dy}px) scale(${1 - progress * 0.55})` : '';
    dim(p.backdrop, dy > 0 ? Math.max(0, 1 - Math.min(1, dy / 320)) : 1, animate);
  };

  /** Fast exit: the card keeps shrinking into a small card and flies up, like closing an app from the nav bar. */
  const exit = (el: HTMLElement) => {
    const p = parts(el);
    if (!p) return;
    p.card.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
    p.card.style.transform = `translateY(${-window.innerHeight * 0.5}px) scale(0.3)`;
    dim(p.backdrop, 0, true);
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
      exit(el);
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
