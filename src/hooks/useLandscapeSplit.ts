import { useEffect, useState } from 'react';
import { getStoredItem, setStoredItem } from '../utils/storage';

/** A phone held sideways: landscape and short. Tablets / desktops (taller viewports) keep the normal layout. */
const QUERY = '(orientation: landscape) and (max-height: 540px)';

export function useLandscapePhone(): boolean {
  const [match, setMatch] = useState<boolean>(() => {
    try {
      return window.matchMedia(QUERY).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(QUERY);
    } catch {
      return;
    }
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

/** Hides the system status bar (native app) or goes fullscreen on the first touch (browser) while `active`. */
export function useHideStatusBar(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let native = false;
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        native = true;
        const { StatusBar } = await import('@capacitor/status-bar');
        if (!cancelled) await StatusBar.hide();
      } catch {
        /* plugin not available: ignore */
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
          const { Capacitor } = await import('@capacitor/core');
          if (Capacitor.isNativePlatform()) {
            const { StatusBar } = await import('@capacitor/status-bar');
            await StatusBar.show();
          }
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
  };
  return { ratio, setRatio, swapped, toggleSwapped };
}
