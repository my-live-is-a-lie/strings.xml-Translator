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
function swap(h: ReturnType<typeof renderSwapHook>, position: 'top' | 'bottom') {
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

  it('shows the pulse animation after a swap and clears it after 260ms', () => {
    const h = renderSwapHook(freshKey());
    swap(h, 'bottom');
    expect(h.result.bind('bottom').className).toContain('animate-in');
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(h.result.bind('bottom').className).not.toContain('animate-in');
    h.unmount();
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

  it('cancels the pulse timer when unmounted right after a swap', () => {
    const h = renderSwapHook(freshKey());
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    swap(h, 'bottom');
    expect(h.result.swapped).toBe(true);
    // Identify the 260ms pulse timer by its delay (the 400ms click-suppression timer
    // is started just before it, and React may schedule its own timers too).
    const pulseCall = setTimeoutSpy.mock.calls.findIndex((c) => c[1] === 260);
    const pulseTimerId = setTimeoutSpy.mock.results[pulseCall]?.value;
    expect(pulseTimerId).toBeDefined();
    h.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(pulseTimerId);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  });
});
