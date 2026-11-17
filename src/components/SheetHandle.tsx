import { useEffect, useRef, useState } from 'react';

interface SheetHandleProps {
  onClose: () => void;
  /** Distance (px) after which letting go closes the window. */
  threshold?: number;
}

const EXIT_MS = 70;
const SPRING_MS = 280;
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const PILL_TRANSITION = `width 160ms ease-out, transform ${SPRING_MS}ms ${SPRING}`;

/** Rubber band: grows quickly at first, then resists more and more (never passes ~60px). */
const rubber = (x: number): number => {
  const dim = 60;
  return dim * (1 - 1 / ((x * 0.5) / dim + 1));
};

/**
 * Pill at the bottom of a dialog, behaving like the Android navigation-bar gesture.
 *  - Pressing it widens the pill from both ends; letting go shrinks it back.
 *  - Dragging UP: the dialog follows the finger and shrinks into a small card (no fading). Letting go far enough
 *    (or with a quick flick) closes it with a very short shrink-and-fly-up animation, otherwise it springs back.
 *  - Dragging DOWN: rubber-band resistance. The dialog moves down a little while it grows, and the pill sinks
 *    a little; letting go springs both back.
 * The dialog is the closest `[role="dialog"]` ancestor and its parent is treated as the dimmed backdrop.
 */
export function SheetHandle({ onClose, threshold = 110 }: SheetHandleProps) {
  const drag = useRef<{ id: number; startY: number; lastY: number; lastT: number; velocity: number; dy: number } | null>(null);
  const timer = useRef<number | null>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const [pressed, setPressed] = useState(false);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const parts = (el: HTMLElement) => {
    const card = el.closest<HTMLElement>('[role="dialog"]');
    return card ? { card, backdrop: card.parentElement } : null;
  };

  // Only the dimmed background fades (never the dialog itself, which is a child of it, so no `opacity` here)
  const dim = (backdrop: HTMLElement | null, factor: number, transition: string) => {
    if (!backdrop) return;
    backdrop.style.transition = transition;
    backdrop.style.backgroundColor = factor < 1 ? `rgba(0, 0, 0, ${0.6 * factor})` : '';
    backdrop.style.backdropFilter = factor < 1 ? 'none' : '';
  };

  const setPill = (y: number, animate: boolean) => {
    const el = pill.current;
    if (!el) return;
    el.style.transition = animate ? PILL_TRANSITION : 'width 160ms ease-out';
    el.style.transform = y ? `translateY(${y}px)` : '';
  };

  /** Follows the finger upwards: translate + shrink. */
  const paintUp = (el: HTMLElement, dy: number) => {
    const p = parts(el);
    if (!p) return;
    const progress = Math.min(1, dy / Math.max(1, window.innerHeight * 0.5));
    p.card.style.transition = 'none';
    p.card.style.transformOrigin = '50% 100%';
    p.card.style.transform = `translateY(${-dy}px) scale(${1 - progress * 0.55})`;
    dim(p.backdrop, Math.max(0, 1 - Math.min(1, dy / 320)), 'none');
    setPill(0, false);
  };

  /** Pulling downwards: rubber-band stretch. The dialog sinks and grows downwards (origin = top edge). */
  const paintDown = (el: HTMLElement, down: number) => {
    const p = parts(el);
    if (!p) return;
    const r = rubber(down);
    p.card.style.transition = 'none';
    p.card.style.transformOrigin = '50% 0%';
    p.card.style.transform = `translateY(${r * 0.3}px) scale(${1 + r * 0.0007})`;
    dim(p.backdrop, 1, 'none');
    setPill(Math.min(10, r * 0.25), false);
  };

  /** Back to the normal size/place with a small elastic overshoot. */
  const springBack = (el: HTMLElement) => {
    const p = parts(el);
    if (p) {
      p.card.style.transition = `transform ${SPRING_MS}ms ${SPRING}`;
      p.card.style.transform = '';
      dim(p.backdrop, 1, `background-color ${SPRING_MS}ms ease-out`);
    }
    setPill(0, true);
  };

  /** Very short exit: the card keeps shrinking into a small card and flies up, like closing an app from the nav bar. */
  const exit = (el: HTMLElement) => {
    const p = parts(el);
    if (!p) return;
    p.card.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
    p.card.style.transform = `translateY(${-window.innerHeight * 0.5}px) scale(0.3)`;
    dim(p.backdrop, 0, `background-color ${EXIT_MS}ms ease-out`);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Touch pointers are already tied to the element they started on; an explicit capture is only needed for a
    // mouse. (Explicit capture on touch can leave the next touch unanswered on Android WebView.)
    if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, dy: 0 };
    setPressed(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.velocity = (d.lastY - e.clientY) / dt; // px/ms, positive = upwards
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    const moved = d.startY - e.clientY; // positive = upwards
    d.dy = Math.max(0, moved);
    if (moved > 0) paintUp(e.currentTarget, moved);
    else paintDown(e.currentTarget, -moved);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setPressed(false);
    const el = e.currentTarget;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const flick = d.velocity > 0.5 && d.dy > 30;
    if (!cancelled && (d.dy >= threshold || flick)) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        onClose();
        return;
      }
      setPill(0, false);
      exit(el);
      timer.current = window.setTimeout(onClose, EXIT_MS);
    } else {
      springBack(el);
    }
  };

  return (
    <div
      role="presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => finish(e, true)}
      style={{ touchAction: 'none' }}
      className="flex items-center justify-center h-9 cursor-grab active:cursor-grabbing select-none shrink-0"
    >
      {/* Centered in a flex row, so changing the width grows / shrinks it from both ends */}
      <span
        ref={pill}
        className={`block h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 ${pressed ? 'w-[3.625rem]' : 'w-12'}`}
        style={{ transition: PILL_TRANSITION }}
      />
    </div>
  );
}
