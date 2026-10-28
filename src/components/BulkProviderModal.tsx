import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { getActiveProviderId, getAllTranslationProviders } from '../utils/translator';
import { getProviderDisplayName } from './ProvidersPanel';
import { useDialog } from '../utils/useDialog';

/** Not a real provider: opens the copy/paste (or file) flow through an external AI app. */
export const EXTERNAL_AI_PROVIDER_ID = '__external_ai__';

interface Props {
  count: number;
  appLang: 'ar' | 'en';
  onClose: () => void;
  onConfirm: (providerId: string) => void;
}

/** Asks which translation provider to use before a bulk translation starts. Only mounted while open. */
export const BulkProviderModal: React.FC<Props> = ({ count, appLang, onClose, onConfirm }) => {
  const isAr = appLang === 'ar';
  // Providers that need a key are only offered once a key has been saved
  const [providers] = useState(() => getAllTranslationProviders().filter((p) => p.isBuiltIn || p.apiKey));
  const [selected, setSelected] = useState(() => {
    const active = getActiveProviderId();
    return providers.some((p) => p.id === active) ? active : providers[0]?.id ?? '';
  });
  const dialogRef = useDialog<HTMLDivElement>(true, onClose);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-provider-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1E1F20] border border-slate-200 dark:border-slate-700 shadow-xl p-4 space-y-3 text-slate-800 dark:text-slate-100"
      >
        <h2 id="bulk-provider-title" className="text-sm font-semibold">
          {isAr ? `اختر مزوّد الترجمة (${count} نص)` : `Choose a translation provider (${count} strings)`}
        </h2>
        <div role="radiogroup" aria-labelledby="bulk-provider-title" className="space-y-1.5 max-h-64 overflow-y-auto">
          {providers.map((p) => (
            <label
              key={p.id}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer text-sm ${
                selected === p.id
                  ? 'border-[#0B57D0] dark:border-[#A8C7FA] bg-[#0B57D0]/5 dark:bg-[#A8C7FA]/10'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="bulk-provider"
                data-provider-id={p.id}
                checked={selected === p.id}
                onChange={() => setSelected(p.id)}
                className="accent-[#0B57D0]"
              />
              <span className="flex-1 min-w-0 truncate">{getProviderDisplayName(p, isAr)}</span>
            </label>
          ))}
          <label
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer text-sm ${
              selected === EXTERNAL_AI_PROVIDER_ID
                ? 'border-[#0B57D0] dark:border-[#A8C7FA] bg-[#0B57D0]/5 dark:bg-[#A8C7FA]/10'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <input
              type="radio"
              name="bulk-provider"
              data-provider-id={EXTERNAL_AI_PROVIDER_ID}
              checked={selected === EXTERNAL_AI_PROVIDER_ID}
              onChange={() => setSelected(EXTERNAL_AI_PROVIDER_ID)}
              className="accent-[#0B57D0]"
            />
            <span className="flex-1 min-w-0">
              {isAr ? 'تطبيق ذكاء اصطناعي خارجي (ChatGPT، Gemini…) — نسخ/لصق أو ملف' : 'External AI app (ChatGPT, Gemini…) — copy/paste or file'}
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full text-sm border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            id="bulk-provider-start"
            disabled={!selected}
            onClick={() => onConfirm(selected)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium bg-[#1EB996] text-white cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {selected === EXTERNAL_AI_PROVIDER_ID ? (isAr ? 'متابعة' : 'Continue') : isAr ? 'ابدأ الترجمة' : 'Start'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
