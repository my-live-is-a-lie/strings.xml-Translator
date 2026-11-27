import React, { useRef } from 'react';
import { Clipboard, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useT } from '../i18n/i18n';

const EASE = 'ease-[cubic-bezier(0.4,0,0.2,1)]';

// The Web Clipboard API is unreliable inside the Capacitor WebView (Android rejects
// navigator.clipboard.readText() without a native permission grant), so the native
// Clipboard plugin reads the clipboard there; the web API stays for browsers.
export async function readClipboardText(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const { Clipboard: NativeClipboard } = await import('@capacitor/clipboard');
    const { value } = await NativeClipboard.read();
    return value || '';
  }
  return navigator.clipboard.readText();
}

/** Two icons stacked in one spot; the active one rotates/scales in while the other rotates/scales out. */
function IconSwap({ showSecond, first, second }: { showSecond: boolean; first: React.ReactNode; second: React.ReactNode }) {
  const base = `absolute inset-0 flex items-center justify-center transition-all duration-300 ${EASE} motion-reduce:transition-none`;
  return (
    <span className="relative block w-4 h-4">
      <span className={`${base} ${showSecond ? 'opacity-0 scale-50 -rotate-90' : 'opacity-100 scale-100 rotate-0'}`}>{first}</span>
      <span className={`${base} ${showSecond ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 rotate-90'}`}>{second}</span>
    </span>
  );
}

/**
 * API-key input: paste button that turns into a clear button once there is text, always masked (no reveal),
 * and horizontal drag-scrolling for long values.
 */
export function SecretField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef({ x: 0, left: 0, moved: false });

  const hasText = value.length > 0;
  const handlePaste = async () => {
    try {
      const text = (await readClipboardText()).trim();
      if (text) {
        onChange(text);
      }
    } catch {
      inputRef.current?.focus(); // clipboard blocked: let the user paste manually
    }
  };
  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };
  const iconBtn =
    'p-1 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-200/80 dark:hover:bg-[#252E40] transition cursor-pointer';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 min-h-[26px]">
        <label htmlFor={id} className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
          {label}
        </label>
        <div dir="ltr" className="flex items-center">
          {/* Paste <-> Clear */}
          <button
            type="button"
            onClick={hasText ? handleClear : handlePaste}
            className={iconBtn}
            title={hasText ? t('clear_key_field') : t('paste_from_clipboard')}
            aria-label={hasText ? t('clear_key_field') : t('paste_from_clipboard')}
          >
            <IconSwap showSecond={hasText} first={<Clipboard className="w-4 h-4" />} second={<X className="w-4 h-4" />} />
          </button>
        </div>
      </div>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          e.stopPropagation();
          const el = inputRef.current;
          drag.current = { x: e.touches[0].clientX, left: el ? el.scrollLeft : 0, moved: false };
        }}
        onTouchMove={(e) => {
          const el = inputRef.current;
          if (!el || el.scrollWidth <= el.clientWidth) return;
          const dx = e.touches[0].clientX - drag.current.x;
          if (Math.abs(dx) > 6) drag.current.moved = true;
          if (drag.current.moved) el.scrollLeft = drag.current.left - dx;
        }}
        onTouchEnd={(e) => {
          if (drag.current.moved && e.cancelable) e.preventDefault(); // a drag must not move the caret
        }}
        placeholder={placeholder}
        required={required}
        style={{
          touchAction: 'pan-y',
          // Always masked, never revealable; the real value stays selectable/editable and scrolls sideways.
          WebkitTextSecurity: 'disc',
        } as React.CSSProperties}
        className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
      />
    </div>
  );
}
