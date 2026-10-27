import { useEffect, useRef } from 'react';
import { isDocumentRtl } from '../utils/direction';

interface ShortcutHandlers {
  onUndo: () => void;
  onRedo: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onNextUntranslated: () => void;
  onShowHelp: () => void;
}

/**
 * App-wide keyboard shortcuts: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, Ctrl+Enter, Alt+Arrow (direction aware),
 * Ctrl+J or Alt+U, and "?" for the help dialog (ignored while typing in a field).
 */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  // Always call the latest handlers without re-attaching the listener on every render
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = ref.current;
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === '?' && !mod && !e.altKey) {
        const el = e.target as HTMLElement | null;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        if (!typing) {
          e.preventDefault();
          h.onShowHelp();
          return;
        }
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        h.onUndo();
        return;
      }
      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        h.onRedo();
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        h.onNext();
      }
      // The "next" arrow follows the page direction, matching the mirrored buttons
      const rtl = isDocumentRtl();
      if (e.altKey && e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) {
        e.preventDefault();
        h.onNext();
      }
      if (e.altKey && e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) {
        e.preventDefault();
        h.onPrevious();
      }
      if ((mod && e.key === 'j') || (e.altKey && e.key.toLowerCase() === 'u')) {
        e.preventDefault();
        h.onNextUntranslated();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
