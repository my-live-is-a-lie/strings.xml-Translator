/* eslint-disable react-hooks/immutability -- `ctx` is deliberate mutable bookkeeping for pointer gestures: it is only
   written from event handlers and callback refs and never read while rendering. */
import { useCallback, useState } from 'react';
import { getStoredItem, setStoredItem } from '../utils/storage';

/**
 * A: the text button of the first cell, B: the button of the second cell, I: the round icon button in the first cell
 * (next to A).
 */
type Side = 'A' | 'B' | 'I';

type Live = { a: number; b: number; extra: number };

type Gesture = {
  side: Side;
  pointerId: number;
  x0: number;
  y0: number;
  timer: number | undefined;
  active: boolean;
  moved: boolean;
  // widths of the two cells and the icon's extra width when the hold completed
  a0: number;
  b0: number;
  extra0: number;
  // how far each kind of change may go
  maxOuter: number; // what the neighbour cell can give while its text still fits
  maxInner: number; // what the text button can give to the icon
  maxGiveBack: number; // what the icon has (its extra width) and can give back to the text button
  // +1 when dragging to the right grows towards the other thing, -1 to the left
  signOuter: 1 | -1;
  signToText: 1 | -1;
  result: Live | null;
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
  // getBoundingClientRect works for SVG icons too (they have no offsetWidth / scrollWidth)
  const content =
    kids.reduce((sum, k) => sum + Math.max(k.getBoundingClientRect().width, k.scrollWidth || 0), 0) +
    gap * Math.max(0, kids.length - 1);
  return content + PAD_X * 2;
}

/**
 * Two neighbouring cells (A and B) of a two-column grid whose widths the person can trade, plus the round icon button
 * next to A, whose width can be traded with A's text button.
 *
 * Press and hold a button, then drag towards the one next to it to widen it at the other's expense. The widening
 * follows the finger, stops while the other button can still show its text on one line, and can be undone by dragging
 * back while the finger is still down. Once the finger is lifted, the only way to give the width back is to do the
 * same with the neighbour. The split is remembered.
 */
export function useResizablePair(storageKey: string) {
  // Mutable bookkeeping that never affects rendering (kept off refs so it can be read from event handlers only)
  const [ctx] = useState(() => ({
    grid: null as HTMLDivElement | null,
    btnA: null as HTMLButtonElement | null,
    btnB: null as HTMLButtonElement | null,
    icon: null as HTMLButtonElement | null,
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
  const setIcon = useCallback(
    (el: HTMLButtonElement | null) => {
      ctx.icon = el;
    },
    [ctx]
  );

  const [ratio, setRatio] = useState<number>(() => {
    const n = parseFloat(getStoredItem(storageKey) ?? '');
    return Number.isFinite(n) ? Math.min(0.75, Math.max(0.25, n)) : 0.5;
  });
  const [extra, setExtra] = useState<number>(() => {
    const n = parseFloat(getStoredItem(storageKey + '_icon') ?? '');
    return Number.isFinite(n) ? Math.min(240, Math.max(0, n)) : 0;
  });
  const [live, setLive] = useState<Live | null>(null);
  const [activeSide, setActiveSide] = useState<Side | null>(null);

  const finish = useCallback(
    (commit: boolean) => {
      const g = ctx.gesture;
      if (!g) return;
      window.clearTimeout(g.timer);
      ctx.gesture = null;
      if (g.active) {
        if (commit && g.result) {
          const { a, b, extra: e } = g.result;
          let next = a / (a + b);
          // back to the original equal split
          if (Math.abs(a - b) <= SNAP_PX) next = 0.5;
          setRatio(next);
          setStoredItem(storageKey, String(next));
          setExtra(e);
          setStoredItem(storageKey + '_icon', String(e));
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
    const g: Gesture = {
      side,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      timer: undefined,
      active: false,
      moved: false,
      a0: 0,
      b0: 0,
      extra0: 0,
      maxOuter: 0,
      maxInner: 0,
      maxGiveBack: 0,
      signOuter: 1,
      signToText: 1,
      result: null,
    };
    g.timer = window.setTimeout(() => {
      const { grid, btnA, btnB, icon } = ctx;
      if (!grid || !btnA || !btnB || !icon || ctx.gesture !== g) return;
      const colA = grid.children[0] as HTMLElement;
      const colB = grid.children[1] as HTMLElement;
      const ra = colA.getBoundingClientRect();
      const rb = colB.getBoundingClientRect();
      const rText = btnA.getBoundingClientRect();
      const rIcon = icon.getBoundingClientRect();
      g.a0 = ra.width;
      g.b0 = rb.width;
      g.extra0 = extra;
      const minTextA = minButtonWidth(btnA);
      const minTextB = minButtonWidth(btnB);
      // a cell can never be narrower than what its content needs: for A that is the icon, the gap and A's text
      const minB = rb.width - btnB.getBoundingClientRect().width + minTextB;
      const minA = ra.width - rText.width + minTextA;
      g.maxOuter = Math.max(0, (side === 'B' ? g.a0 - minA : g.b0 - minB));
      g.maxInner = Math.max(0, rText.width - minTextA);
      g.maxGiveBack = Math.max(0, extra);
      // dragging towards the neighbour widens the pressed button
      g.signOuter = (side === 'B' ? ra.left > rb.left : rb.left > ra.left) ? 1 : -1;
      g.signToText = rIcon.left < rText.left ? 1 : -1;
      g.active = true;
      g.result = { a: g.a0, b: g.b0, extra };
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
      setLive(g.result);
    }, HOLD_MS);
    ctx.gesture = g;
  };

  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
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
    if (Math.abs(dx) > MOVED_PX) g.moved = true;

    let a = g.a0;
    let b = g.b0;
    let extraNow = g.extra0;

    if (g.side === 'I') {
      // the icon widens when dragged towards the text button, at the text button's expense
      extraNow = g.extra0 + Math.min(g.maxInner, Math.max(0, dx * g.signToText));
    } else {
      // never smaller than at the start of this press, never so large that the neighbour's text no longer fits
      const towardsNeighbour = dx * g.signOuter;
      if (towardsNeighbour > 0 || g.side === 'B') {
        const grow = Math.min(g.maxOuter, Math.max(0, towardsNeighbour));
        if (g.side === 'A') {
          a = g.a0 + grow;
          b = g.b0 - grow;
        } else {
          b = g.b0 + grow;
          a = g.a0 - grow;
        }
        // the equal split is a stop of its own
        if (grow > 0 && Math.abs(a - b) <= SNAP_PX) {
          const half = (a + b) / 2;
          a = half;
          b = half;
        }
      } else {
        // A's text button dragged the other way, towards the icon: it takes back width the icon had gained
        const giveBack = Math.min(g.maxGiveBack, Math.max(0, dx * -g.signToText));
        extraNow = g.extra0 - giveBack;
      }
    }
    g.result = { a, b, extra: extraNow };
    setLive(g.result);
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
      ? `${live.a}px ${live.b}px`
      : `minmax(0, ${ratio}fr) minmax(0, ${1 - ratio}fr)`,
    transition: live ? 'none' : 'grid-template-columns 200ms cubic-bezier(0.22, 1, 0.36, 1)',
  };
  const iconExtra = live ? live.extra : extra;

  // [what to render, what to attach]: the second part holds everything that touches the gesture bookkeeping
  return [
    { gridStyle, activeSide, iconExtra },
    { setGrid, setBtnA, setBtnB, setIcon, onDown, onMove, onUp, onClickCapture },
  ] as const;
}
