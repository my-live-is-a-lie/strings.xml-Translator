/* eslint-disable react-hooks/immutability -- `ctx` is deliberate mutable bookkeeping for a pointer gesture: it is
   only written from event handlers and never read while rendering. */
import { flushSync } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  // distance between the two rows, measured when the hold completes; the drag-follow clamps to it
  pitch: number;
  // the finger moved substantially while held (so releasing must not leak a click)
  moved: boolean;
  reducedMotion: boolean;
  // latest finger position, updated on every processed pointermove — the commit resets the
  // drag origin here so dragging back reverses the swap
  lastX: number;
  lastY: number;
  // the pointer went up while a commit animation was running
  released: boolean;
};

const HOLD_MS = 420; // press and hold this long before a drag can swap the buttons
const CANCEL_MOVE_PX = 10; // moving further than this before the hold completes means it was an ordinary tap/swipe
const SWAP_PX = 40; // how far to drag, once held, before the swap fires
const SLIDE_MS = 250; // how long the swap slide takes
const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'; // fast ease-out, same curve as the row resize
const SPRING_MS = 180; // how long a cancelled drag takes to spring back to its row
const CLICK_SUPPRESS_MS = 400; // how long a click is suppressed after a swap or a cancelled drag

// No brightness filter here: a filter on the held button duplicated its text (a faint copy offset
// downward) on the phone's GPU compositor while held/dragged. No scale either: the CSS `scale` property
// composes before `transform`, so it scales the drag/commit translateY itself — a 1.04 scale turns a 46px
// displacement into ~47.8px, overshooting the target row and snapping back ~2.6px at the commit. The ring
// alone carries the lift look.
const LIFT_CLASS = 'ring-2 ring-white/50 z-10';

/**
 * Two vertically-stacked buttons (`top` and `bottom`) whose places the person can swap: press and hold either one,
 * then drag it towards the other (up from the bottom slot, or down from the top slot) to swap their positions. The
 * choice is remembered. While dragging, the held button tracks the finger (and the other button counter-moves), so
 * the two pills trade places as the finger moves. When the swap threshold is reached, the pills first animate to
 * their target rows keeping the content in the same nodes (a two-phase commit), and only then does the content flip
 * — with the transforms cleared in the same frame, so each pill stays in its visual row across the commit instead of
 * jumping back. Releasing before the swap threshold springs the buttons back.
 */
export function useColumnSwap(storageKey: string) {
  const [swapped, setSwapped] = useState<boolean>(() => getStoredItem(storageKey) === '1');
  const [liftedPosition, setLiftedPosition] = useState<Position | null>(null);
  const [ctx] = useState(() => ({ gesture: null as Gesture | null, suppressClick: false }));

  // The two physical buttons, registered by position through bind()'s ref callback.
  const elsRef = useRef<{ top: HTMLButtonElement | null; bottom: HTMLButtonElement | null }>({
    top: null,
    bottom: null,
  });
  const topRef = useCallback((el: HTMLButtonElement | null) => {
    elsRef.current.top = el;
  }, []);
  const bottomRef = useCallback((el: HTMLButtonElement | null) => {
    elsRef.current.bottom = el;
  }, []);

  // Timers that outlive a gesture: cancelled on unmount so no state update runs after
  // the component is gone (the hold timer lifts the button; the click-suppression
  // timer only flips a plain flag, so it needs no cleanup).
  const holdTimerRef = useRef<number | undefined>(undefined);
  const springTimerRef = useRef<number | undefined>(undefined);
  // Cleanup for a pending commit animation (its transitionend listener + fallback timer): cancelled on unmount
  // or on a new press, so a stale commit cannot fire afterwards.
  const commitCleanupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(
    () => () => {
      if (holdTimerRef.current !== undefined) window.clearTimeout(holdTimerRef.current);
      if (springTimerRef.current !== undefined) window.clearTimeout(springTimerRef.current);
      commitCleanupRef.current?.();
      commitCleanupRef.current = undefined;
    },
    []
  );

  // Removes the drag-follow / spring-back inline styles from both buttons, and cancels any pending spring-back
  // cleanup. Used when a visual operation ends without a commit following it (drag cancelled without a spring,
  // new press, unmount). NOT used on the swap path: there the commit animation takes over from the in-flight drag
  // transform, and clearing first would snap the pills back and break the trade-places motion.
  const clearDragVisuals = useCallback(() => {
    if (springTimerRef.current !== undefined) {
      window.clearTimeout(springTimerRef.current);
      springTimerRef.current = undefined;
    }
    const top = elsRef.current.top;
    const bottom = elsRef.current.bottom;
    for (const el of [top, bottom]) {
      if (!el) continue;
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
    }
  }, []);

  // Animates both buttons back to their rows after a cancelled drag, then clears the inline styles. No-op when
  // nothing was displaced (e.g. reduced motion, where drag-follow never applied a transform).
  const springBack = useCallback(() => {
    const top = elsRef.current.top;
    const bottom = elsRef.current.bottom;
    if (!top || !bottom) return;
    if (!top.style.transform && !bottom.style.transform) return;
    if (springTimerRef.current !== undefined) window.clearTimeout(springTimerRef.current);
    for (const el of [top, bottom]) {
      el.style.transition = `transform ${SPRING_MS}ms ease-out`;
      el.style.transform = 'translateY(0)';
    }
    springTimerRef.current = window.setTimeout(() => {
      springTimerRef.current = undefined;
      clearDragVisuals();
    }, SPRING_MS + 80);
  }, [clearDragVisuals]);

  // Cancels a pending commit animation without committing: removes its transitionend listeners and clears its
  // fallback timer. Used on a new press (a second finger aborts the in-flight swap) and on unmount.
  const cancelCommit = useCallback(() => {
    const cleanup = commitCleanupRef.current;
    commitCleanupRef.current = undefined;
    cleanup?.();
  }, []);

  // Phase 2 of the swap: the pills have been animated to their target rows (phase 1) with the content still in
  // the original nodes. Flip `swapped` and clear the transforms in the same frame, with no transition: the content
  // after the flip matches the visual row each node was displaced to, so each pill stays in its visual row across
  // the commit — no jump, no reversal. There is no FLIP effect on `swapped`, so the flip itself animates nothing.
  const commitSwap = useCallback(
    (g: Gesture) => {
      const top = elsRef.current.top;
      const bottom = elsRef.current.bottom;
      for (const el of [top, bottom]) {
        if (!el) continue;
        el.style.transition = 'none';
        el.style.transform = '';
        el.style.opacity = '';
        el.style.willChange = '';
      }
      // Force a style recalc so the cleared transform is committed with `transition: none` in effect — the
      // jump this commit exists to avoid.
      if (top) void top.getBoundingClientRect();
      else if (bottom) void bottom.getBoundingClientRect();
      // Decide the gesture reset first (mutable bookkeeping, not state). The pointer is still down and this is
      // still the current gesture: reset it so dragging back reverses the swap. The held content is now in the
      // opposite row, so the gesture's position flips and the drag origin moves to the finger's current position.
      const keepGesture = ctx.gesture === g && !g.released;
      if (keepGesture) {
        g.position = g.position === 'top' ? 'bottom' : 'top';
        g.x0 = g.lastX;
        g.y0 = g.lastY;
        g.triggered = false;
        g.moved = true;
      }
      // Flush the content flip and the lift move synchronously, in the same task as the transform clearing
      // above, and still under `transition: none`: each button's background and text color belong to its
      // content ('skip' is teal, 'suggest' is grey), so flipping the content changes a real button's own
      // className, not just which row shows which color. With the inline transition already restored to the
      // buttons' own (Tailwind) transition, the browser would animate that color change — each button
      // visibly flashing to the *other's* color and fading back to its own over the transition's duration.
      // Flipping the content while transition is still 'none' makes that change land instantly, same as the
      // transform clear above. (A plain setState here would be batched and could flush a task later, after
      // the browser has already painted the cleared transforms with the old content.)
      flushSync(() => {
        setSwapped((prev) => {
          const next = !prev;
          setStoredItem(storageKey, next ? '1' : '0');
          return next;
        });
        // The lift ring follows the held content to its new row; if the pointer went up mid-commit (or a new
        // press took over), the gesture is already gone and the ring just clears.
        setLiftedPosition(keepGesture ? g.position : null);
      });
      // Now that the transform clear and the content flip have both landed under `transition: none`, hand
      // control back to the buttons' own transition classes for whatever changes next (hover, active, the
      // next swap). Force a recalc first so this doesn't itself re-open a window to animate the change above.
      if (top) void top.getBoundingClientRect();
      else if (bottom) void bottom.getBoundingClientRect();
      for (const el of [top, bottom]) {
        if (!el) continue;
        el.style.transition = '';
      }
      try {
        navigator.vibrate?.(18);
      } catch {
        /* no haptics here */
      }
    },
    [ctx, storageKey]
  );

  // Phase 1 of the swap: animate both pills to their target rows, continuing the drag direction and keeping the
  // content in the same nodes — the held pill from its current drag displacement to its target row, the other
  // counter-moving to the opposite row. Only when the animation finishes does commitSwap() flip the content
  // (phase 2), so each pill moves monotonically through the swap instead of jumping back to its home row.
  const startCommitAnimation = useCallback(
    (g: Gesture) => {
      const top = elsRef.current.top;
      const bottom = elsRef.current.bottom;
      const held = top && bottom ? elsRef.current[g.position] : null;
      const other = top && bottom ? elsRef.current[g.position === 'top' ? 'bottom' : 'top'] : null;
      if (!top || !bottom || !held || !other || g.reducedMotion || g.pitch <= 0) {
        // No animation (reduced motion, no pitch, or buttons not registered): commit at once.
        commitSwap(g);
        return;
      }
      const dir = g.position === 'top' ? 1 : -1; // the held pill moves down (+1) from the top row
      for (const [el, target] of [
        [held, dir * g.pitch],
        [other, -dir * g.pitch],
      ] as const) {
        el.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}, opacity ${SLIDE_MS}ms ${SLIDE_EASING}`;
        el.style.transform = `translateY(${target}px)`;
        // The two pills travel the same column by equal and opposite distances, so they are exactly
        // superimposed partway through the slide. At full opacity the one in front (the held pill, raised
        // above the other by the lift ring's z-index) completely hides the other at that instant — its
        // own color appears to cover both rows for a frame, which reads as the two pills' colors swapping.
        // Dimming both during the slide turns that instant into a visible blend of the two colors instead.
        el.style.opacity = '0.6';
        el.style.willChange = 'transform, opacity';
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        commitCleanupRef.current = undefined;
        window.clearTimeout(timer);
        for (const el of [held, other]) el.removeEventListener('transitionend', onTransitionEnd);
        commitSwap(g);
      };
      const onTransitionEnd = (e: TransitionEvent) => {
        if (e.propertyName === 'transform') finish();
      };
      // Cancel without committing (new press / unmount): remove the listeners and the fallback timer.
      commitCleanupRef.current = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        for (const el of [held, other]) el.removeEventListener('transitionend', onTransitionEnd);
      };
      for (const el of [held, other]) el.addEventListener('transitionend', onTransitionEnd);
      // transitionend may never fire (already at the target, element hidden): commit anyway once the
      // animation should have finished.
      const timer = window.setTimeout(finish, SLIDE_MS + 120);
    },
    [commitSwap]
  );

  const clearGesture = useCallback(() => {
    if (ctx.gesture) window.clearTimeout(ctx.gesture.timer);
    ctx.gesture = null;
    holdTimerRef.current = undefined;
    setLiftedPosition(null);
  }, [ctx]);

  const onPointerDown = useCallback(
    (position: Position, e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // A new press aborts any spring-back still running from the previous gesture, and any commit animation
      // still in flight (a second finger aborts the in-flight swap: the pills snap back to their rows, so the
      // new gesture starts from a clean state).
      cancelCommit();
      clearDragVisuals();
      clearGesture();
      const g: Gesture = {
        position,
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        timer: undefined,
        active: false,
        triggered: false,
        pitch: 0,
        moved: false,
        reducedMotion:
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        lastX: e.clientX,
        lastY: e.clientY,
        released: false,
      };
      g.timer = window.setTimeout(() => {
        holdTimerRef.current = undefined;
        if (ctx.gesture !== g) return;
        g.active = true;
        // Measure the row distance once, before any transform is applied (getBoundingClientRect includes
        // transforms, so measuring later would read the displaced positions).
        const top = elsRef.current.top;
        const bottom = elsRef.current.bottom;
        if (top && bottom) {
          const pitch = Math.abs(bottom.getBoundingClientRect().top - top.getBoundingClientRect().top);
          g.pitch = Number.isFinite(pitch) ? pitch : 0;
        }
        setLiftedPosition(position);
        try {
          navigator.vibrate?.(10);
        } catch {
          /* no haptics here */
        }
      }, HOLD_MS);
      holdTimerRef.current = g.timer;
      ctx.gesture = g;
    },
    [ctx, cancelCommit, clearGesture, clearDragVisuals]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const g = ctx.gesture;
      if (!g || g.pointerId !== e.pointerId) return;
      // Always remember the finger's latest position — including while a commit animation is
      // running (g.triggered): the commit resets the drag origin to lastX/lastY, and if those
      // froze at the trigger point the pills jump by the whole distance the finger moved during
      // the animation when the drag resumes (on the phone that reads as a ghost duplicate of
      // the pill). Tracking it here keeps the origin current, so the drag continues smoothly.
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (!g.active) {
        if (Math.hypot(dx, dy) > CANCEL_MOVE_PX) clearGesture();
        return;
      }
      if (g.triggered) return;
      if (Math.abs(dy) > CANCEL_MOVE_PX) g.moved = true;
      // Drag-follow (direct manipulation): the held button tracks the finger's vertical displacement, and the
      // other button in the column counter-moves, so the two pills trade places as the finger moves and cross at
      // the midpoint. Direct style writes only — no React state per pointermove — and vertical only, so the
      // horizontal resize gesture is untouched. `transition: none` keeps the tracking 1:1 instead of lagging
      // behind the buttons' Tailwind transition.
      //
      // The clamp is one-sided, not ±pitch: a 'bottom' pill only has somewhere to go upward (toward the
      // swap), and a 'top' pill only downward. Clamping symmetrically let the held pill keep following the
      // finger past its own row in the *other* direction — nothing above a 'top' pill or below a 'bottom'
      // one to receive it — so it could ride up over the toolbar row (or down past its row) with no swap
      // to show for it. That is also what a drag that continues past a just-committed swap looked like:
      // commitSwap() flips `g.position` to carry on a reversing drag, and without this one-sided clamp the
      // same continued motion in the *original* direction (now the wrong way for the new position) dragged
      // the pill off its row again, springing back with a visible jump on release.
      if (!g.reducedMotion && g.pitch > 0) {
        const held = elsRef.current[g.position];
        const other = elsRef.current[g.position === 'top' ? 'bottom' : 'top'];
        if (held && other) {
          const clamped =
            g.position === 'bottom'
              ? Math.max(-g.pitch, Math.min(0, dy))
              : Math.max(0, Math.min(g.pitch, dy));
          for (const [el, ty] of [
            [held, clamped],
            [other, -clamped],
          ] as const) {
            el.style.transition = 'none';
            el.style.willChange = 'transform';
            el.style.transform = `translateY(${ty}px)`;
          }
        }
      }
      const swapsNow =
        (g.position === 'bottom' && dy < -SWAP_PX) || (g.position === 'top' && dy > SWAP_PX);
      if (swapsNow) {
        g.triggered = true;
        ctx.suppressClick = true;
        window.setTimeout(() => {
          ctx.suppressClick = false;
        }, CLICK_SUPPRESS_MS);
        // Do NOT clear the drag transforms or the gesture here: phase 1 of the commit animates the pills
        // from their current drag displacement to their target rows, and phase 2 (when that animation
        // finishes) flips the content and resets the gesture so dragging back reverses the swap. Clearing
        // the transforms first would snap the pills back and break the trade-places motion.
        startCommitAnimation(g);
      }
    },
    [ctx, clearGesture, startCommitAnimation]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const g = ctx.gesture;
      if (g && g.pointerId === e.pointerId) {
        if (g.triggered) {
          // A commit animation is running: the pills must finish trading places. Do not clear the drag
          // visuals (that would break the commit animation); just note the pointer is up, so the commit
          // clears the gesture instead of resetting it for a reverse-swap.
          g.released = true;
        } else if (g.active) {
          // A cancelled drag must not leak a click: the pointer is captured by the held button, so the click
          // that follows pointerup would otherwise activate it (or, without capture, the button under the
          // finger). Suppress it like the post-swap click.
          if (g.moved) {
            ctx.suppressClick = true;
            window.setTimeout(() => {
              ctx.suppressClick = false;
            }, CLICK_SUPPRESS_MS);
          }
          springBack();
        } else {
          clearDragVisuals();
        }
        clearGesture();
      }
    },
    [ctx, clearGesture, springBack, clearDragVisuals]
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
      ref: position === 'top' ? topRef : bottomRef,
      className: liftedPosition === position ? LIFT_CLASS : '',
    }),
    [onPointerDown, onPointerMove, onPointerUp, onClickCapture, liftedPosition, topRef, bottomRef]
  );

  return { swapped, bind };
}
