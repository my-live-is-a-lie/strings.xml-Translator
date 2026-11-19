// @vitest-environment jsdom
// Tests for the long-press + drag column swap (useColumnSwap) and for the gesture
// timer cleanup on unmount. No testing library is installed, so the hook is driven
// through a tiny render harness (createRoot + act) and its bound handlers are called
// with plain pointer-event objects.
import { act, createElement, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useColumnSwap } from './useColumnSwap';
import { getStoredItem } from '../utils/storage';
import * as storage from '../utils/storage';

// React's act() needs the test-environment flag when rendering outside a runner setup.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useColumnSwap>;

function pointerEvent(overrides: Partial<{ clientX: number; clientY: number; pointerId: number; pointerType: string; button: number }> = {}): ReactPointerEvent<HTMLButtonElement> {
  return {
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    clientX: 100,
    clientY: 200,
    ...overrides,
  } as unknown as ReactPointerEvent<HTMLButtonElement>;
}

function clickEvent(): { event: ReactMouseEvent<HTMLButtonElement>; preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const event = { preventDefault, stopPropagation } as unknown as ReactMouseEvent<HTMLButtonElement>;
  return { event, preventDefault, stopPropagation };
}

function renderSwapHook(storageKey: string) {
  let latest: HookResult | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  function Probe() {
    const result = useColumnSwap(storageKey);
    latest = result;
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return {
    get result(): HookResult {
      if (!latest) throw new Error('hook did not render');
      return latest;
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Drives a full swap gesture: press and hold, then drag past the 40px threshold. */
function swap(h: { result: HookResult }, position: 'top' | 'bottom') {
  const dy = position === 'bottom' ? -50 : 50;
  act(() => {
    h.result.bind(position).onPointerDown(pointerEvent());
  });
  act(() => {
    vi.advanceTimersByTime(420);
  });
  act(() => {
    h.result.bind(position).onPointerMove(pointerEvent({ clientY: 200 + dy }));
  });
}

/** Renders the hook with two real buttons attached through bind()'s ref callbacks, so the commit animation has
 *  elements to move and the hold can measure the row pitch. The buttons sit 48px apart vertically (tops 100 and
 *  148) once getBoundingClientRect is mocked in the test. */
function renderSwapHookWithButtons(storageKey: string) {
  let latest: HookResult | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  function Probe() {
    const result = useColumnSwap(storageKey);
    latest = result;
    return createElement(
      'div',
      null,
      createElement('button', { ref: result.bind('top').ref, id: 'top-btn' }, 'top'),
      createElement('button', { ref: result.bind('bottom').ref, id: 'bottom-btn' }, 'bottom')
    );
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return {
    get result(): HookResult {
      if (!latest) throw new Error('hook did not render');
      return latest;
    },
    topBtn: () => container.querySelector('#top-btn') as HTMLButtonElement,
    bottomBtn: () => container.querySelector('#bottom-btn') as HTMLButtonElement,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Mocks getBoundingClientRect so the two buttons sit 48px apart vertically — and, like a real browser, the
 *  returned top includes any translateY currently applied to the element, so the hold-time pitch measurement
 *  reads the true row distance. */
function mockButtonRects() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const base = this.id === 'top-btn' ? 100 : 148;
    const tyMatch = /translateY\(\s*(-?[\d.]+)px\s*\)/.exec(this.style.transform || '');
    const top = base + (tyMatch ? parseFloat(tyMatch[1]) : 0);
    return {
      x: 0,
      y: top,
      width: 200,
      height: 40,
      top,
      right: 200,
      bottom: top + 40,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

describe('useColumnSwap', () => {
  let keyCounter = 0;
  const freshKey = () => `test_column_swap_${keyCounter++}_v1`;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('swaps the bottom button after hold + upward drag, and remembers the choice', () => {
    const key = freshKey();
    const h = renderSwapHook(key);
    expect(h.result.swapped).toBe(false);
    swap(h, 'bottom');
    expect(h.result.swapped).toBe(true);
    expect(getStoredItem(key)).toBe('1');
    h.unmount();
  });

  it('swaps the top button after hold + downward drag', () => {
    const h = renderSwapHook(freshKey());
    swap(h, 'top');
    expect(h.result.swapped).toBe(true);
    h.unmount();
  });

  it('lifts the button once the hold completes, before any drag', () => {
    const h = renderSwapHook(freshKey());
    act(() => {
      h.result.bind('bottom').onPointerDown(pointerEvent());
    });
    expect(h.result.bind('bottom').className).not.toContain('ring-2');
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(h.result.bind('bottom').className).toContain('ring-2');
    // No filter on the lifted button: the brightness filter duplicated the held button's text on the
    // phone's GPU compositor (see the flicker fix). The ring is the lift affordance.
    expect(h.result.bind('bottom').className).not.toContain('brightness');
    expect(h.result.bind('bottom').className).not.toContain('filter');
    // No scale on the lifted button either: the CSS `scale` property composes before `transform`, so it
    // scales the drag/commit translateY itself and overshoots the target row (~2.6px snap back at the
    // commit). The ring alone is the lift affordance.
    expect(h.result.bind('bottom').className).not.toContain('scale-');
    h.unmount();
  });

  it('does not swap on a horizontal drag after the hold', () => {
    const h = renderSwapHook(freshKey());
    act(() => {
      h.result.bind('bottom').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    act(() => {
      h.result.bind('bottom').onPointerMove(pointerEvent({ clientX: 100 + 60 }));
    });
    expect(h.result.swapped).toBe(false);
    h.unmount();
  });

  it('does not swap when released before the hold completes', () => {
    const h = renderSwapHook(freshKey());
    act(() => {
      h.result.bind('bottom').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      h.result.bind('bottom').onPointerUp(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(h.result.swapped).toBe(false);
    expect(h.result.bind('bottom').className).not.toContain('ring-2');
    h.unmount();
  });

  it('cancels the gesture when moved before the hold completes', () => {
    const h = renderSwapHook(freshKey());
    act(() => {
      h.result.bind('bottom').onPointerDown(pointerEvent());
    });
    act(() => {
      h.result.bind('bottom').onPointerMove(pointerEvent({ clientX: 100 + 20 }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(h.result.swapped).toBe(false);
    expect(h.result.bind('bottom').className).not.toContain('ring-2');
    h.unmount();
  });

  it('suppresses the click right after a swap, then lets clicks through again', () => {
    const h = renderSwapHook(freshKey());
    swap(h, 'bottom');
    expect(h.result.swapped).toBe(true);
    const first = clickEvent();
    act(() => {
      h.result.bind('bottom').onClickCapture(first.event);
    });
    expect(first.preventDefault).toHaveBeenCalled();
    expect(first.stopPropagation).toHaveBeenCalled();
    const second = clickEvent();
    act(() => {
      h.result.bind('bottom').onClickCapture(second.event);
    });
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(second.stopPropagation).not.toHaveBeenCalled();
    h.unmount();
  });

  it('trades the buttons places on swap: animates to the target rows first, then flips the content with styles cleared', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('bottom').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    // Drag up 45px: past the 40px threshold, so the swap starts — but the content does NOT flip yet.
    // Phase 1 animates both buttons to their target rows, keeping the content in the same nodes: the held
    // bottom button to the top row (-48px), the top button to the bottom row (+48px).
    act(() => {
      h.result.bind('bottom').onPointerMove(pointerEvent({ clientY: 155 }));
    });
    expect(h.result.swapped).toBe(false);
    expect(h.bottomBtn().style.transform).toBe('translateY(-48px)');
    expect(h.topBtn().style.transform).toBe('translateY(48px)');
    expect(h.bottomBtn().style.transition).toContain('250ms');
    // Both pills are dimmed for the slide: they travel the same column by equal and opposite distances, so
    // they are exactly superimposed partway through, and at full opacity the held one (raised above the
    // other by the lift ring) would completely hide it for a frame instead of visibly crossing.
    expect(h.bottomBtn().style.opacity).toBe('0.6');
    expect(h.topBtn().style.opacity).toBe('0.6');
    // Phase 2 commits once the animation finishes (fallback timer): the content flips and the inline styles
    // are cleared, with the buttons already in their new rows.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(h.result.swapped).toBe(true);
    expect(h.topBtn().style.transform).toBe('');
    expect(h.topBtn().style.transition).toBe('');
    expect(h.topBtn().style.opacity).toBe('');
    expect(h.bottomBtn().style.transform).toBe('');
    expect(h.bottomBtn().style.transition).toBe('');
    expect(h.bottomBtn().style.opacity).toBe('');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('keeps transitions off through the content flip, not just the transform clear', () => {
    // Regression test: the caller re-renders each button's own className when `swapped` flips (its color
    // belongs to its content, e.g. a 'skip' button is teal and a 'suggest' button is grey — swapping which
    // content a button holds changes that button's own color, not just which row shows which color). If the
    // inline `transition: none` were restored *before* that content flip lands, the browser would animate
    // the resulting color change over the button's own (Tailwind) transition — each button briefly flashing
    // to the color it's leaving and fading back to the one it's taking on. `setStoredItem` is called from
    // inside the same state update that flips `swapped`, synchronously and still under `transition: none`;
    // it stands in here for "the content flip is landing now".
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    const transitionsAtFlip: { top: string; bottom: string } | null = (() => {
      let captured: { top: string; bottom: string } | null = null;
      const realSetStoredItem = storage.setStoredItem;
      const storeSpy = vi.spyOn(storage, 'setStoredItem').mockImplementation((key, value) => {
        captured = { top: h.topBtn().style.transition, bottom: h.bottomBtn().style.transition };
        realSetStoredItem(key, value);
      });
      act(() => {
        h.result.bind('top').onPointerDown(pointerEvent());
      });
      act(() => {
        vi.advanceTimersByTime(420);
      });
      act(() => {
        h.result.bind('top').onPointerMove(pointerEvent({ clientY: 250 }));
      });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      storeSpy.mockRestore();
      return captured;
    })();
    expect(h.result.swapped).toBe(true);
    expect(transitionsAtFlip).toEqual({ top: 'none', bottom: 'none' });
    // The transition is restored only once the flip has landed.
    expect(h.topBtn().style.transition).toBe('');
    expect(h.bottomBtn().style.transition).toBe('');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('follows the finger while dragging: held button tracks dy, other counter-moves', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    // Drag down 20px (below the 40px swap threshold): the held top button tracks the finger, the bottom
    // one counter-moves by the same amount.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 220 }));
    });
    expect(h.topBtn().style.transform).toBe('translateY(20px)');
    expect(h.bottomBtn().style.transform).toBe('translateY(-20px)');
    expect(h.topBtn().style.transition).toBe('none');
    // Further down, still below the threshold: both keep tracking.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 235 }));
    });
    expect(h.topBtn().style.transform).toBe('translateY(35px)');
    expect(h.bottomBtn().style.transform).toBe('translateY(-35px)');
    // Dragging back moves the buttons back with the finger.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 210 }));
    });
    expect(h.topBtn().style.transform).toBe('translateY(10px)');
    expect(h.bottomBtn().style.transform).toBe('translateY(-10px)');
    expect(h.result.swapped).toBe(false);
    rectSpy.mockRestore();
    h.unmount();
  });

  it('does not drag-follow at all when dragging away from the other row (nothing there to receive it)', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    // Dragging up from the top row (the wrong way for a swap): the clamp is one-sided, so the held button
    // stays put instead of riding up past its own row with nothing above to receive it.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 100 }));
    });
    expect(h.topBtn().style.transform).toBe('translateY(0px)');
    expect(h.bottomBtn().style.transform).toBe('translateY(0px)');
    expect(h.result.swapped).toBe(false);
    rectSpy.mockRestore();
    h.unmount();
  });

  it('does not flip the content or jump at the threshold: the dragged pill keeps moving in the drag direction', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    // Drag down 45px: past the threshold. The held top button stays on the drag side (down, +48px) through
    // the commit animation — it never jumps up to the other row the way the old FLIP made it — and the
    // content has not flipped yet.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 245 }));
    });
    expect(h.result.swapped).toBe(false);
    expect(h.topBtn().style.transform).toBe('translateY(48px)');
    expect(h.bottomBtn().style.transform).toBe('translateY(-48px)');
    // The commit lands the swap with the buttons already in their new rows.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(h.result.swapped).toBe(true);
    expect(h.topBtn().style.transform).toBe('');
    expect(h.bottomBtn().style.transform).toBe('');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('keeps tracking the finger smoothly when it moves during the commit animation (no jump from a stale drag origin)', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    // Drag down past the threshold: the swap starts (phase 1 animates the pills to their target rows).
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 250 }));
    });
    expect(h.result.swapped).toBe(false);
    expect(h.topBtn().style.transform).toBe('translateY(48px)');
    // The finger keeps moving further down WHILE the commit animation is still running. The drag origin
    // must follow it: if it froze at the trigger point (clientY 250), the commit would reset the origin
    // there and the next move would apply the whole distance the finger travelled during the animation
    // at once — the pills would jump ~40px on a 10px finger move (on the phone that reads as a ghost
    // duplicate of the pill).
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 280 }));
    });
    expect(h.topBtn().style.transform).toBe('translateY(48px)');
    // The commit lands (fallback timer): the content flips, the styles are cleared, the held content is
    // now in the bottom row.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(h.result.swapped).toBe(true);
    expect(h.topBtn().style.transform).toBe('');
    expect(h.bottomBtn().style.transform).toBe('');
    // Move the finger 10px back up from where it was when the commit landed (clientY 280): the held
    // bottom button must track just those 10px, not the 40px the finger covered during the animation
    // (that staler, larger distance is what a frozen drag origin would produce instead). Moving up
    // rather than on down the same way as before the commit, since up is now the valid direction for
    // the bottom position (down has no row below to receive it, and the one-sided clamp zeroes it).
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 270 }));
    });
    expect(h.bottomBtn().style.transform).toBe('translateY(-10px)');
    expect(h.topBtn().style.transform).toBe('translateY(10px)');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('reverses the swap when dragged back in the same gesture', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    // Drag down past the threshold: the swap commits and the held content moves to the bottom row.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 250 }));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(h.result.swapped).toBe(true);
    expect(h.topBtn().style.transform).toBe('');
    // The lift ring follows the held content to its new (bottom) row.
    expect(h.result.bind('bottom').className).toContain('ring-2');
    expect(h.result.bind('top').className).not.toContain('ring-2');
    // Drag back up from the commit point (clientY 250): the held bottom button tracks the finger up.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 230 }));
    });
    expect(h.bottomBtn().style.transform).toBe('translateY(-20px)');
    expect(h.topBtn().style.transform).toBe('translateY(20px)');
    expect(h.result.swapped).toBe(true);
    // Drag up past the threshold again: the reverse swap starts, the content does not flip yet.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 200 }));
    });
    expect(h.result.swapped).toBe(true);
    expect(h.bottomBtn().style.transform).toBe('translateY(-48px)');
    expect(h.topBtn().style.transform).toBe('translateY(48px)');
    // The reverse commit flips the content back.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(h.result.swapped).toBe(false);
    expect(h.topBtn().style.transform).toBe('');
    expect(h.bottomBtn().style.transform).toBe('');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('stops at the row after a swap commits, even if the finger keeps moving the same way', () => {
    // Regression test: holding and dragging straight through a swap (never reversing) used to let the
    // dragged pill keep riding past its own row by a further full pitch, with nothing there to receive
    // it (it could ride up over the UI above the top row, or down past the bottom row). On release it
    // would then spring back from that overshoot, which read as a sudden jump.
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    // Drag down past the threshold: the swap commits (held content moves from the top row to the bottom).
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 250 }));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(h.result.swapped).toBe(true);
    // Keep dragging further down, in the same direction as before — not reversing the swap. The held
    // content is now in the bottom row, where dragging further down is the wrong way (nothing below it
    // to swap with), so it should not move at all.
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 280 }));
    });
    expect(h.topBtn().style.transform).toBe('translateY(0px)');
    expect(h.bottomBtn().style.transform).toBe('translateY(0px)');
    expect(h.result.swapped).toBe(true);
    rectSpy.mockRestore();
    h.unmount();
  });

  it('still completes the swap when the pointer is lifted mid-commit', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 250 }));
    });
    expect(h.result.swapped).toBe(false);
    // Lift the finger while the commit animation is still running: the swap must still land.
    act(() => {
      h.result.bind('top').onPointerUp(pointerEvent({ clientY: 250 }));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(h.result.swapped).toBe(true);
    expect(h.topBtn().style.transform).toBe('');
    expect(h.bottomBtn().style.transform).toBe('');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('springs back on release before the threshold, without swapping', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 220 }));
    });
    expect(h.topBtn().style.transform).toBe('translateY(20px)');
    act(() => {
      h.result.bind('top').onPointerUp(pointerEvent({ clientY: 220 }));
    });
    expect(h.result.swapped).toBe(false);
    expect(h.topBtn().style.transform).toBe('translateY(0)');
    expect(h.topBtn().style.transition).toContain('180ms');
    expect(h.bottomBtn().style.transform).toBe('translateY(0)');
    // After the spring the inline styles are cleared.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(h.topBtn().style.transform).toBe('');
    expect(h.topBtn().style.transition).toBe('');
    expect(h.bottomBtn().style.transform).toBe('');
    expect(h.bottomBtn().style.transition).toBe('');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('suppresses the click after a cancelled drag, then lets clicks through again', () => {
    const h = renderSwapHook(freshKey());
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 220 }));
    });
    act(() => {
      h.result.bind('top').onPointerUp(pointerEvent({ clientY: 220 }));
    });
    expect(h.result.swapped).toBe(false);
    const first = clickEvent();
    act(() => {
      h.result.bind('top').onClickCapture(first.event);
    });
    expect(first.preventDefault).toHaveBeenCalled();
    expect(first.stopPropagation).toHaveBeenCalled();
    const second = clickEvent();
    act(() => {
      h.result.bind('top').onClickCapture(second.event);
    });
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(second.stopPropagation).not.toHaveBeenCalled();
    h.unmount();
  });

  it('does not drag-follow when prefers-reduced-motion is set', () => {
    const h = renderSwapHookWithButtons(freshKey());
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList
    );
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 220 }));
    });
    expect(h.topBtn().style.transform).toBe('');
    expect(h.bottomBtn().style.transform).toBe('');
    expect(h.result.swapped).toBe(false);
    rectSpy.mockRestore();
    h.unmount();
  });

  it('does not slide when prefers-reduced-motion is set', () => {
    const h = renderSwapHookWithButtons(freshKey());
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList
    );
    swap(h, 'bottom');
    expect(h.result.swapped).toBe(true);
    expect(h.topBtn().style.transform).toBe('');
    expect(h.bottomBtn().style.transform).toBe('');
    h.unmount();
  });

  it('does not crash when the buttons are not registered', () => {
    const h = renderSwapHook(freshKey());
    swap(h, 'bottom');
    expect(h.result.swapped).toBe(true);
    h.unmount();
  });

  it('cancels the commit when unmounted mid-animation', () => {
    const h = renderSwapHookWithButtons(freshKey());
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const rectSpy = mockButtonRects();
    act(() => {
      h.result.bind('top').onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    act(() => {
      h.result.bind('top').onPointerMove(pointerEvent({ clientY: 250 }));
    });
    expect(h.result.swapped).toBe(false);
    // Identify the commit fallback timer by its 370ms delay (250ms slide + 120ms).
    const commitCall = setTimeoutSpy.mock.calls.findIndex((c) => c[1] === 370);
    const commitTimerId = setTimeoutSpy.mock.results[commitCall]?.value;
    expect(commitTimerId).toBeDefined();
    h.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(commitTimerId);
    // Advancing time after unmount must not throw or update anything.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rectSpy.mockRestore();
  });

  it('cancels the hold timer when unmounted before the hold completes', () => {
    const h = renderSwapHook(freshKey());
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    act(() => {
      h.result.bind('bottom').onPointerDown(pointerEvent());
    });
    // Identify the hold timer by its 420ms delay (React may schedule its own timers too).
    const holdCall = setTimeoutSpy.mock.calls.findIndex((c) => c[1] === 420);
    const holdTimerId = setTimeoutSpy.mock.results[holdCall]?.value;
    expect(holdTimerId).toBeDefined();
    h.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(holdTimerId);
    // Advancing time after unmount must not throw or update anything.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  });

});
