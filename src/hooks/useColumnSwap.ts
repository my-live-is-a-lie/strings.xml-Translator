/* eslint-disable react-hooks/immutability -- `ctx` is deliberate mutable bookkeeping for a pointer gesture: it is
   only written from event handlers and never read while rendering. */
import { useCallback, useState } from 'react';
import { getStoredItem, setStoredItem } from '../utils/storage';

type Position = 'top' | 'bottom';

type Gesture = {
  position: Position;
  pointerId: number;
  x0: number;
  y0: number;
  timer: number | undefined;
  active: boolean;
  triggered: boolean;
};

const HOLD_MS = 420; // press and hold this long before a drag can swap the buttons
const CANCEL_MOVE_PX = 10; // moving further than this before the hold completes means it was an ordinary tap/swipe
const SWAP_PX = 40; // how far to drag, once held, before the swap fires

const LIFT_CLASS = 'ring-2 ring-white/50 brightness-110 scale-[1.04] z-10';
const PULSE_CLASS = 'animate-in zoom-in-95 duration-200';

/**
 * Two vertically-stacked buttons (`top` and `bottom`) whose places the person can swap: press and hold either one,
 * then drag it towards the other (up from the bottom slot, or down from the top slot) to swap their positions. The
 * choice is remembered.
 */
export function useColumnSwap(storageKey: string) {
  const [swapped, setSwapped] = useState<boolean>(() => getStoredItem(storageKey) === '1');
  const [liftedPosition, setLiftedPosition] = useState<Position | null>(null);
  const [pulse, setPulse] = useState(false);
  const [ctx] = useState(() => ({ gesture: null as Gesture | null, suppressClick: false }));

  const clearGesture = useCallback(() => {
    if (ctx.gesture) window.clearTimeout(ctx.gesture.timer);
    ctx.gesture = null;
    setLiftedPosition(null);
  }, [ctx]);

  const triggerSwap = useCallback(() => {
    setSwapped((prev) => {
      const next = !prev;
      setStoredItem(storageKey, next ? '1' : '0');
      return next;
    });
    setPulse(true);
    window.setTimeout(() => setPulse(false), 260);
    try {
      navigator.vibrate?.(18);
    } catch {
      /* no haptics here */
    }
  }, [storageKey]);

  const onPointerDown = useCallback(
    (position: Position, e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearGesture();
      const g: Gesture = {
        position,
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        timer: undefined,
        active: false,
        triggered: false,
      };
      g.timer = window.setTimeout(() => {
        if (ctx.gesture !== g) return;
        g.active = true;
        setLiftedPosition(position);
        try {
          navigator.vibrate?.(10);
        } catch {
          /* no haptics here */
        }
      }, HOLD_MS);
      ctx.gesture = g;
    },
    [ctx, clearGesture]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const g = ctx.gesture;
      if (!g || g.pointerId !== e.pointerId) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (!g.active) {
        if (Math.hypot(dx, dy) > CANCEL_MOVE_PX) clearGesture();
        return;
      }
      if (g.triggered) return;
      const swapsNow =
        (g.position === 'bottom' && dy < -SWAP_PX) || (g.position === 'top' && dy > SWAP_PX);
      if (swapsNow) {
        g.triggered = true;
        ctx.suppressClick = true;
        window.setTimeout(() => {
          ctx.suppressClick = false;
        }, 400);
        triggerSwap();
        clearGesture();
      }
    },
    [ctx, clearGesture, triggerSwap]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const g = ctx.gesture;
      if (g && g.pointerId === e.pointerId) clearGesture();
    },
    [ctx, clearGesture]
  );

  const onClickCapture = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (ctx.suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        ctx.suppressClick = false;
      }
    },
    [ctx]
  );

  const bind = useCallback(
    (position: Position) => ({
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => onPointerDown(position, e),
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
      className: `${liftedPosition === position ? LIFT_CLASS : ''} ${pulse ? PULSE_CLASS : ''}`.trim(),
    }),
    [onPointerDown, onPointerMove, onPointerUp, onClickCapture, liftedPosition, pulse]
  );

  return { swapped, bind };
}
