// @vitest-environment jsdom
// Tests for useResizablePair: the active-side ring must not stick to a row's slot
// when the button occupying that slot is swapped away mid-press.
import { act, createElement, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResizablePair } from './useResizablePair';

// React's act() needs the test-environment flag when rendering outside a runner setup.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = ReturnType<typeof useResizablePair>;

function pointerEvent(
  overrides: Partial<{ clientX: number; clientY: number; pointerId: number; pointerType: string; button: number }> = {}
): ReactPointerEvent<HTMLButtonElement> {
  return {
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    clientX: 100,
    clientY: 200,
    ...overrides,
  } as unknown as ReactPointerEvent<HTMLButtonElement>;
}

function renderPair(storageKey: string) {
  let latest: HookResult | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  function Probe({ storageKey: key }: { storageKey: string }) {
    const result = useResizablePair(key);
    latest = result;
    const [, h] = result;
    return createElement(
      'div',
      { ref: h.setGrid, id: 'grid' },
      createElement(
        'div',
        { id: 'colA' },
        createElement('button', { ref: h.setIcon, id: 'icon-btn' }, 'i'),
        createElement('button', { ref: h.setBtnA, id: 'btn-a' }, 'A')
      ),
      createElement(
        'div',
        { id: 'colB' },
        createElement('button', { ref: h.setBtnB, id: 'btn-b' }, 'B')
      )
    );
  }
  act(() => {
    root.render(createElement(Probe, { storageKey }));
  });
  return {
    get result(): HookResult {
      if (!latest) throw new Error('hook did not render');
      return latest;
    },
    rerender(key: string) {
      act(() => {
        root.render(createElement(Probe, { storageKey: key }));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Fixed layout: two 200px columns, icon 40px at the left, text button 150px, main button 190px. */
function mockPairRects() {
  const rects: Record<string, { width: number; left: number; top: number; height: number }> = {
    grid: { width: 400, left: 0, top: 0, height: 40 },
    colA: { width: 200, left: 0, top: 0, height: 40 },
    colB: { width: 200, left: 200, top: 0, height: 40 },
    'icon-btn': { width: 40, left: 0, top: 0, height: 40 },
    'btn-a': { width: 150, left: 50, top: 0, height: 40 },
    'btn-b': { width: 190, left: 205, top: 0, height: 40 },
  };
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const r = rects[this.id] ?? { width: 100, left: 0, top: 0, height: 40 };
    return {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      top: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
      left: r.left,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

describe('useResizablePair', () => {
  let keyCounter = 0;
  const freshKey = () => `test_resizable_pair_${keyCounter++}_v1`;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rings the held side once the hold completes', () => {
    const h = renderPair(freshKey());
    const rectSpy = mockPairRects();
    act(() => {
      h.result[1].onDown('A', pointerEvent());
    });
    expect(h.result[0].activeSide).toBe(null);
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(h.result[0].activeSide).toBe('A');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('cancels the resize gesture when the row key changes mid-press (no stale live widths)', () => {
    // The row's content swapped away mid-press (as after a column swap): the resize gesture belongs to
    // the old content, so it must be fully cancelled — not just the ring, but the live pixel widths too,
    // and further moves from the stale gesture must do nothing.
    const h = renderPair(freshKey());
    const rectSpy = mockPairRects();
    act(() => {
      h.result[1].onDown('B', pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(h.result[0].activeSide).toBe('B');
    // Drag left (towards the neighbour) to grow B: the live pixel widths take over the grid.
    act(() => {
      h.result[1].onMove(pointerEvent({ clientX: 70 }));
    });
    expect(h.result[0].gridStyle.gridTemplateColumns).toBe('170px 230px');
    // The row now holds different content (as after a column swap).
    h.rerender(freshKey());
    expect(h.result[0].activeSide).toBe(null);
    expect(h.result[0].gridStyle.gridTemplateColumns).toBe('minmax(0, 0.5fr) minmax(0, 0.5fr)');
    // A further move from the stale gesture must do nothing.
    act(() => {
      h.result[1].onMove(pointerEvent({ clientX: 50 }));
    });
    expect(h.result[0].gridStyle.gridTemplateColumns).toBe('minmax(0, 0.5fr) minmax(0, 0.5fr)');
    rectSpy.mockRestore();
    h.unmount();
  });

  it('clears the ring when the row key changes mid-press (the button swapped away)', () => {
    // The bug: holding Skip (side A of row 1) and swapping it to row 2 left the ring on row 1's new
    // text button (Suggest) — the ring is keyed by row + side, not by the held element. A key change
    // means the row's content swapped, so the ring must clear.
    const h = renderPair(freshKey());
    const rectSpy = mockPairRects();
    act(() => {
      h.result[1].onDown('A', pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(h.result[0].activeSide).toBe('A');
    // The row now holds different content (as after a column swap).
    h.rerender(freshKey());
    expect(h.result[0].activeSide).toBe(null);
    rectSpy.mockRestore();
    h.unmount();
  });

  it('clears the ring on release', () => {
    const h = renderPair(freshKey());
    const rectSpy = mockPairRects();
    act(() => {
      h.result[1].onDown('A', pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(h.result[0].activeSide).toBe('A');
    act(() => {
      h.result[1].onUp(pointerEvent());
    });
    expect(h.result[0].activeSide).toBe(null);
    rectSpy.mockRestore();
    h.unmount();
  });
});
