import { useEffect, useState } from 'react';
import { getStoredItem, setStoredItem } from '../utils/storage';
import { sourceRatio } from '../utils/sourceSync';

/** A phone held sideways: wider than tall and short. Tablets / desktops (taller viewports) keep the normal layout. */
const MAX_LANDSCAPE_HEIGHT = 540;

function isLandscapePhone(): boolean {
  try {
    return window.innerWidth > window.innerHeight && window.innerHeight <= MAX_LANDSCAPE_HEIGHT;
  } catch {
    return false;
  }
}

export function useLandscapePhone(): boolean {
  const [match, setMatch] = useState<boolean>(isLandscapePhone);
  useEffect(() => {
    let lastWidth = window.innerWidth;
    const update = () => {
      // The on-screen keyboard shrinks the height but not the width: while a text field is focused and the width is
      // unchanged, keep the current layout. Otherwise a small preview pane flips to "landscape" the moment the
      // keyboard opens, which remounts the layout and closes whatever the person was opening (e.g. the search bar).
      const el = document.activeElement as HTMLElement | null;
      const typingNow =
        !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio'].includes((el as HTMLInputElement).type)));
      const width = window.innerWidth;
      if (typingNow && width === lastWidth) return;
      lastWidth = width;
      setMatch(isLandscapePhone());
    };
    update();
    // some WebViews only report the new size a moment after the rotation, so listen to every signal
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const t = window.setInterval(update, 1000);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.clearInterval(t);
    };
  }, []);
  return match;
}

/**
 * Hides the system status bar while `active` (landscape): through Capacitor's SystemBars on the Android app,
 * or fullscreen on the first touch in a browser. Portrait always shows it again.
 */
export function useHideStatusBar(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let native = false;
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor, SystemBars, SystemBarType } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        native = true;
        if (!cancelled) await SystemBars.hide({ bar: SystemBarType.StatusBar });
      } catch {
        /* not available: ignore */
      }
    })();
    const goFullscreen = () => {
      if (native || document.fullscreenElement) return;
      try {
        void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => undefined);
      } catch {
        /* fullscreen not allowed here */
      }
    };
    document.addEventListener('pointerdown', goFullscreen, { once: true });
    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', goFullscreen);
      (async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
        } catch {
          /* ignore */
        }
        try {
          const { Capacitor, SystemBars, SystemBarType } = await import('@capacitor/core');
          if (Capacitor.isNativePlatform()) await SystemBars.show({ bar: SystemBarType.StatusBar });
        } catch {
          /* ignore */
        }
      })();
    };
  }, [active]);
}

const RATIO_KEY = 'landscape_split_ratio_v1';
const SWAP_KEY = 'landscape_split_swapped_v1';
export const SPLIT_MIN = 0.35; // 50% ± 15%
export const SPLIT_MAX = 0.65;

/** Persisted split state: share of the screen taken by the source/info half, and whether the halves are swapped. */
export function useSplitState() {
  const [ratio, setRatioState] = useState<number>(() => {
    const n = parseFloat(getStoredItem(RATIO_KEY) ?? '');
    return Number.isFinite(n) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n)) : 0.5;
  });
  const [swapped, setSwappedState] = useState<boolean>(() => getStoredItem(SWAP_KEY) === 'true');
  const setRatio = (r: number) => {
    const v = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r));
    setRatioState(v);
    setStoredItem(RATIO_KEY, String(v));
  };
  const toggleSwapped = () => {
    setSwappedState((s) => {
      setStoredItem(SWAP_KEY, String(!s));
      return !s;
    });
    // swapping always gives two equal halves again
    setRatioState(0.5);
    setStoredItem(RATIO_KEY, '0.5');
  };
  return { ratio, setRatio, swapped, toggleSwapped };
}

/** True while a text field is focused (i.e. the on-screen keyboard is most likely open). */
export function useTextFieldFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = document.activeElement as HTMLElement | null;
      setFocused(!!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio') || el.isContentEditable));
    };
    const onOut = () => setTimeout(check, 0);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return focused;
}

/**
 * Portrait phones: while the person types in the translation box and the source text or the box is covered
 * (small screens only: tablets and desktops have room, so nothing happens there), the top area (progress, filters, list button) slides away so the
 * source text and the box stay visible. It comes back when the box loses focus. The decision is made once
 * per focus (no flapping): re-checked after the keyboard settles, and after each edit that grows the text.
 */
export function useKeyboardCollapse(enabled: boolean): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const evaluate = () => {
      const el = document.activeElement as HTMLElement | null;
      const scroller = document.querySelector<HTMLElement>('[data-editor-scroll]');
      if (!el || !scroller || el.tagName !== 'TEXTAREA' || !scroller.contains(el)) {
        setCollapsed(false);
        return;
      }
      // only act when the source text or the box being typed in is actually covered (top edge or keyboard)
      const src = scroller.querySelector<HTMLElement>('.kb-src');
      const area = scroller.getBoundingClientRect();
      const top = area.top;
      const bottom = Math.min(area.bottom, window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight);
      const covered = (r: DOMRect) => r.top < top - 2 || r.bottom > bottom + 2;
      if (!(src && covered(src.getBoundingClientRect())) && !covered(el.getBoundingClientRect())) return;
      setCollapsed((prev) => {
        if (!prev) {
          // once the area has slid away, bring the source and the caret line into view
          window.setTimeout(() => {
            scroller.scrollTop = 0;
            const vh = window.visualViewport?.height ?? window.innerHeight;
            const r = el.getBoundingClientRect();
            if (r.bottom > vh) scroller.scrollTop += r.bottom - vh + 8;
          }, 260);
        }
        return true;
      });
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, 250);
    };
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('input', schedule);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('input', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [enabled]);
  return enabled && collapsed;
}

/**
 * Portrait phones: when, even with the top area away, the source text or the translation box is still covered,
 * both get a short scrollable window (the source up to 6 lines, the box what is left, at least 3-4 lines) so
 * that the source and the line being typed are visible together above the keyboard. The source window follows
 * the caret (see sourceRatio); scrolling it by hand pauses that until the next keystroke. When everything fits
 * (tablets, desktops, short texts) nothing is limited. Works on the DOM directly: no re-render per keystroke.
 */
const tallestViewport = { width: 0, height: 0 };
/** True when the visual viewport is clearly shorter than the tallest one seen at this width (the keyboard is up). */
function keyboardOpen(viewH: number): boolean {
  if (tallestViewport.width !== window.innerWidth) {
    tallestViewport.width = window.innerWidth;
    tallestViewport.height = 0;
  }
  tallestViewport.height = Math.max(tallestViewport.height, window.innerHeight, viewH);
  return viewH < tallestViewport.height - 120;
}

export function useSourceWindow(enabled: boolean, topAreaAway: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let syncTimer: number | undefined;
    let paused = false;
    // Scroll events caused by the code itself or by typing are not "the person scrolling by hand"
    let quietUntil = 0;
    const expected = new WeakMap<HTMLElement, { top: number; until: number }>();
    const quiet = (ms: number) => {
      quietUntil = Math.max(quietUntil, performance.now() + ms);
    };

    const parts = () => {
      const scroller = document.querySelector<HTMLElement>('[data-editor-scroll]');
      const span = scroller?.querySelector<HTMLElement>('[data-src-text]') ?? null;
      const el = document.activeElement as HTMLElement | null;
      const ta = el && el.tagName === 'TEXTAREA' && scroller?.contains(el) ? (el as HTMLTextAreaElement) : null;
      return { scroller, span, ta };
    };
    const clear = (span: HTMLElement | null, ta: HTMLElement | null) => {
      // every translation box, not only the focused one: the box loses focus when the keyboard closes
      const boxes = Array.from(document.querySelectorAll<HTMLElement>('[data-editor-scroll] textarea'));
      for (const n of [span, ta, ...boxes]) {
        if (!n) continue;
        n.style.maxHeight = '';
        n.style.overflowY = '';
        n.style.scrollbarWidth = '';
      }
      if (span) delete span.dataset.win;
    };
    const limit = (n: HTMLElement, max: number) => {
      n.style.maxHeight = `${Math.round(max)}px`;
      n.style.overflowY = 'auto';
      n.style.scrollbarWidth = 'none';
    };
    const lineHeight = (n: HTMLElement, fallback: number) => parseFloat(getComputedStyle(n).lineHeight) || fallback;

    const sync = () => {
      const { span, ta } = parts();
      if (!span || !ta || span.dataset.win !== '1' || paused) return;
      const ratio = sourceRatio(ta.value, ta.selectionStart ?? ta.value.length, span.dataset.srcRaw ?? span.textContent ?? '');
      const top = Math.max(0, ratio * span.scrollHeight - span.clientHeight / 2);
      quiet(700);
      span.scrollTo({ top, behavior: 'smooth' });
    };
    const scheduleSync = () => {
      quiet(500);
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(sync, 80);
    };

    const evaluate = () => {
      const { scroller, span, ta } = parts();
      if (!scroller || !span) return;
      quiet(700);
      clear(span, ta);
      if (!ta) return;
      // only while the on-screen keyboard is really up (the viewport shrank): otherwise the page just scrolls
      const vv = window.visualViewport;
      const viewH = vv ? vv.height : window.innerHeight;
      if (!keyboardOpen(viewH)) return;
      const area = scroller.getBoundingClientRect();
      const top = area.top;
      const bottom = Math.min(area.bottom, vv ? vv.offsetTop + viewH : window.innerHeight);

      const srcLH = lineHeight(span, 20);
      const cs = getComputedStyle(ta);
      const taLH = lineHeight(ta, 22);
      const taPad = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce(
        (sum, k) => sum + (parseFloat(cs[k as 'paddingTop']) || 0),
        0
      );
      // Room for the two boxes: what is visible, minus whatever sits above them (the buttons below can be
      // reached by scrolling, so they take no room). The two boxes share it equally.
      const above = ta.getBoundingClientRect().top - top + scroller.scrollTop - span.offsetHeight;
      const room = bottom - top - above - 8;
      const srcNat = span.scrollHeight;
      const taNat = ta.scrollHeight;
      if (srcNat + taNat <= room) return; // everything fits: nothing is limited

      const half = room / 2;
      let srcMax = half;
      let taMax = half;
      if (srcNat <= half) taMax = room - srcNat;
      else if (taNat <= half) srcMax = room - taNat;
      // whole lines only (never a cut line), at least three each
      const srcLines = Math.max(3, Math.floor(srcMax / srcLH));
      const taLines = Math.max(3, Math.floor((taMax - taPad) / taLH));
      if (srcNat > srcLines * srcLH + 2) {
        limit(span, srcLines * srcLH);
        span.dataset.win = '1';
      }
      const taCap = taLines * taLH + taPad;
      if (taNat > taCap + 2) {
        limit(ta, taCap);
        // typing at the end of the text: keep the caret line inside the capped box
        if ((ta.selectionStart ?? 0) >= ta.value.length) ta.scrollTop = ta.scrollHeight;
      }

      // keep the line being typed above the keyboard, then point the source at it
      scroller.scrollTop = 0;
      const r = ta.getBoundingClientRect();
      if (r.bottom > bottom) scroller.scrollTop += r.bottom - bottom + 6;
      sync();
    };
    const schedule = () => {
      keyboardOpen(window.visualViewport?.height ?? window.innerHeight); // remembers the full height while the keyboard is down
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, 260);
    };

    const onInput = () => {
      paused = false;
      quiet(500);
      schedule();
      scheduleSync();
    };
    // The two boxes scroll together: moving one by hand moves the other to the same relative place
    const mirror = (from: HTMLElement, to: HTMLElement) => {
      const fromMax = from.scrollHeight - from.clientHeight;
      const toMax = to.scrollHeight - to.clientHeight;
      if (fromMax <= 1 || toMax <= 1) return;
      // exactly at either end of one box means exactly at the same end of the other
      const f = from.scrollTop <= 2 ? 0 : from.scrollTop >= fromMax - 2 ? 1 : from.scrollTop / fromMax;
      to.scrollTop = f * toMax;
      expected.set(to, { top: to.scrollTop, until: performance.now() + 150 });
    };
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || performance.now() < quietUntil) return;
      const { scroller, span } = parts();
      if (!scroller || !span || span.dataset.win !== '1') return;
      // the scroll event of our own write (a short time window, so returning to the same spot by hand still counts)
      const own = expected.get(t);
      if (own && performance.now() < own.until && Math.abs(own.top - t.scrollTop) < 1.5) return;
      if (t === span) {
        const ta = scroller.querySelector<HTMLTextAreaElement>('textarea[style*="max-height"]');
        paused = true;
        if (ta) mirror(span, ta);
      } else if (t.tagName === 'TEXTAREA' && scroller.contains(t) && t.style.maxHeight) {
        paused = true;
        mirror(t, span);
      }
    };
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('input', onInput);
    document.addEventListener('keyup', scheduleSync);
    document.addEventListener('selectionchange', scheduleSync);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    schedule();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(syncTimer);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('input', onInput);
      document.removeEventListener('keyup', scheduleSync);
      document.removeEventListener('selectionchange', scheduleSync);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      const { span, ta } = parts();
      clear(span, ta);
    };
  }, [enabled, topAreaAway]);
}
