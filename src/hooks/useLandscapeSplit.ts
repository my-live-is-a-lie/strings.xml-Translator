import { useEffect, useState } from 'react';
import { getStoredItem, setStoredItem } from '../utils/storage';

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
    const update = () => setMatch(isLandscapePhone());
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
