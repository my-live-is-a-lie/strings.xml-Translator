/* eslint-disable react-hooks/immutability -- `ctx` is deliberate mutable bookkeeping for pointer gestures: it is only
   written from event handlers and callback refs and never read while rendering. */
import { useCallback, useState } from 'react';
import { getStoredItem, setStoredItem } from '../utils/storage';

type Side = 'A' | 'B';

type Gesture = {
    side: Side;
    pointerId: number;
    x0: number;
    y0: number;
    timer: number | undefined;
    active: boolean;
    moved: boolean;
    a0: number;
    b0: number;
    maxGrow: number;
    sign: 1 | -1;
    result: [number, number] | null;
  };

const HOLD_MS = 420; // press and hold this long to start resizing
const CANCEL_MOVE_PX = 10; // moving further than this before the hold completes means it was an ordinary swipe
const MOVED_PX = 6; // movement after the hold that counts as a resize (so a plain long press still acts as a tap)
const SNAP_PX = 10; // within this distance of the original (equal) widths the pair snaps back to it
const PAD_X = 20; // breathing room kept on each side of a button's content

/** Width a button needs to show all of its content on a single line. */
function minButtonWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const gap = parseFloat(style.columnGap) || 0;
  const kids = Array.from(el.children) as HTMLElement[];
  const content = kids.reduce((sum, k) => sum + Math.max(k.scrollWidth, k.offsetWidth), 0) + gap * Math.max(0, kids.length - 1);
  return content + PAD_X * 2;
}

/**
 * Two neighbouring cells (A and B) of a two-column grid whose widths the person can trade:
 * press and hold one of the two text buttons, then drag towards the other one to widen it at the other's expense.
 * The widening follows the finger, stops while the other button can still show its text on one line, and can be
 * undone by dragging back while the finger is still down. Once the finger is lifted, the only way to give the width
 * back is to do the same with the other button. The split is remembered.
 */
export function useResizablePair(storageKey: string) {
  // Mutable bookkeeping that never affects rendering (kept off refs so it can be read from event handlers only)
  const [ctx] = useState(() => ({
    grid: null as HTMLDivElement | null,
    btnA: null as HTMLButtonElement | null,
    btnB: null as HTMLButtonElement | null,
    gesture: null as Gesture | null,
    suppressClick: false,
  }));
  const setGrid = useCallback(
    (el: HTMLDivElement | null) => {
      ctx.grid = el;
    },
    [ctx]
  );
  const setBtnA = useCallback(
    (el: HTMLButtonElement | null) => {
      ctx.btnA = el;
    },
    [ctx]
  );
  const setBtnB = useCallback(
    (el: HTMLButtonElement | null) => {
      ctx.btnB = el;
    },
    [ctx]
  );

  const [ratio, setRatio] = useState<number>(() => {
    const n = parseFloat(getStoredItem(storageKey) ?? '');
    return Number.isFinite(n) ? Math.min(0.75, Math.max(0.25, n)) : 0.5;
  });
  const [live, setLive] = useState<[number, number] | null>(null);
  const [activeSide, setActiveSide] = useState<Side | null>(null);


  const finish = useCallback(
    (commit: boolean) => {
      const g = ctx.gesture;
      if (!g) return;
      window.clearTimeout(g.timer);
      ctx.gesture = null;
      if (g.active) {
        if (commit && g.result) {
          const [a, b] = g.result;
          let next = a / (a + b);
          // back to the original equal split
          if (Math.abs(a - b) <= SNAP_PX) next = 0.5;
          setRatio(next);
          setStoredItem(storageKey, String(next));
        }
        if (g.moved) {
          ctx.suppressClick = true;
          window.setTimeout(() => {
            ctx.suppressClick = false;
          }, 400);
        }
      }
      setLive(null);
      setActiveSide(null);
    },
    [storageKey, ctx]
  );

  const onDown = (side: Side, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (ctx.gesture) finish(false);
    const target = e.currentTarget;
    const g = {
      side,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      timer: undefined as number | undefined,
      active: false,
      moved: false,
      a0: 0,
      b0: 0,
      maxGrow: 0,
      sign: 1 as 1 | -1,
      result: null as [number, number] | null,
    };
    g.timer = window.setTimeout(() => {
      const grid = ctx.grid;
      const btnA = ctx.btnA;
      const btnB = ctx.btnB;
      if (!grid || !btnA || !btnB || ctx.gesture !== g) return;
      const colA = grid.children[0] as HTMLElement;
      const colB = grid.children[1] as HTMLElement;
      const ra = colA.getBoundingClientRect();
      const rb = colB.getBoundingClientRect();
      g.a0 = ra.width;
      g.b0 = rb.width;
      const minA = ra.width - btnA.getBoundingClientRect().width + minButtonWidth(btnA);
      const minB = rb.width - btnB.getBoundingClientRect().width + minButtonWidth(btnB);
      const neighbourWidth = side === 'A' ? g.b0 : g.a0;
      const neighbourMin = side === 'A' ? minB : minA;
      g.maxGrow = Math.max(0, neighbourWidth - neighbourMin);
      // the pressed button grows when dragged towards its neighbour
      const neighbourIsRight = side === 'A' ? rb.left > ra.left : ra.left > rb.left;
      g.sign = neighbourIsRight ? 1 : -1;
      g.active = true;
      g.result = [g.a0, g.b0];
      try {
        target.setPointerCapture(g.pointerId);
      } catch {
        /* pointer already gone */
      }
      try {
        navigator.vibrate?.(12);
      } catch {
        /* no haptics here */
      }
      setActiveSide(side);
      setLive([g.a0, g.b0]);
    }, HOLD_MS);
    ctx.gesture = g;
  };

  const onMove = (side: Side, e: React.PointerEvent<HTMLButtonElement>) => {
    const g = ctx.gesture;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    if (!g.active) {
      if (Math.hypot(dx, e.clientY - g.y0) > CANCEL_MOVE_PX) {
        window.clearTimeout(g.timer);
        ctx.gesture = null;
      }
      return;
    }
    // never smaller than at the start of this press, never so large that the neighbour's text no longer fits
    const grow = Math.min(g.maxGrow, Math.max(0, dx * g.sign));
    if (Math.abs(dx) > MOVED_PX) g.moved = true;
    const pressedStart = side === 'A' ? g.a0 : g.b0;
    const neighbourStart = side === 'A' ? g.b0 : g.a0;
    let pressed = pressedStart + grow;
    let neighbour = neighbourStart - grow;
    // the equal split is a stop of its own
    const a = side === 'A' ? pressed : neighbour;
    const b = side === 'A' ? neighbour : pressed;
    if (Math.abs(a - b) <= SNAP_PX && grow > 0) {
      const half = (a + b) / 2;
      pressed = half;
      neighbour = half;
    }
    const next: [number, number] = side === 'A' ? [pressed, neighbour] : [neighbour, pressed];
    g.result = next;
    setLive(next);
  };

  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (ctx.gesture && ctx.gesture.pointerId === e.pointerId) finish(true);
  };

  const onClickCapture = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (ctx.suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      ctx.suppressClick = false;
    }
  };

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: live
      ? `${live[0]}px ${live[1]}px`
      : `minmax(0, ${ratio}fr) minmax(0, ${1 - ratio}fr)`,
    transition: live ? 'none' : 'grid-template-columns 200ms cubic-bezier(0.22, 1, 0.36, 1)',
  };

  // [what to render, what to attach]: the second part holds everything that touches refs
  return [{ gridStyle, activeSide }, { setGrid, setBtnA, setBtnB, onDown, onMove, onUp, onClickCapture }] as const;
}
