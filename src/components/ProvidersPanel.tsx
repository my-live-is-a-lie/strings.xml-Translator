import React, {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ChevronDown,
  Cpu,
  KeyRound,
  Plus,
} from 'lucide-react';
import {
  TranslationProviderConfig,
  getAllTranslationProviders,
  GTX_STATUS_EVENT,
  gtxLooksUnavailable,
  getActiveProviderId,
  setActiveProviderId,
  removeCustomProvider,
} from '../utils/translator';
import { AddProviderForm } from './providers/AddProviderForm';
import { ActiveProviderControls } from './providers/ActiveProviderControls';
import { ProviderListItem } from './providers/ProviderListItem';
import { DeleteProviderDialog } from './providers/DeleteProviderDialog';
import { useT, tg } from '../i18n/i18n';
import { getProviderRuntimeErrorsSnapshot, subscribeModelLists } from '../utils/providerModels';

export function getProviderDisplayName(prov: TranslationProviderConfig | undefined, isAr: boolean): string {
  if (!prov) return tg('google_translate');
  if (!isAr || !prov.isBuiltIn) return prov.name;
  if (prov.id === 'google') return 'ترجمة جوجل';
  if (prov.id === 'mymemory') return 'ذاكرة الترجمة (MyMemory)';
  return prov.name;
}

interface ProvidersPanelProps {
  isAr: boolean;
  /** Called after providers are added, edited, removed or the active one changes */
  onChanged: () => void;
  /** The project's target language code */
  targetLang: string;
}

export const ProvidersPanel: React.FC<ProvidersPanelProps> = ({ isAr, onChanged, targetLang }) => {
  const { t } = useT();
  // Translation Providers state inside the sidebar
  const [providersPanelOpen, setProvidersPanelOpen] = useState(false);
  const [providersList, setProvidersList] = useState<TranslationProviderConfig[]>(() =>
    getAllTranslationProviders()
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => getActiveProviderId());

  // Add new API key form state
  const [showAddKeyForm, setShowAddKeyForm] = useState(false);

  // Confirm delete dialog state
  const [providerToDelete, setProviderToDelete] = useState<TranslationProviderConfig | null>(null);

  // The provider whose inline edit form is open
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);

  // Warn when the free Google engine keeps failing, since it relies on an unofficial endpoint.
  // The status is read on every render: it expires with time (no event fires for that), and the
  // panel re-renders when it opens, so the warning is current whenever it is visible.
  const [, setGtxStatusTick] = useState(0);
  useEffect(() => {
    const onChange = () => setGtxStatusTick((n) => n + 1);
    window.addEventListener(GTX_STATUS_EVENT, onChange);
    return () => window.removeEventListener(GTX_STATUS_EVENT, onChange);
  }, []);
  const gtxDown = gtxLooksUnavailable();

  const refresh = () => {
    setProvidersList(getAllTranslationProviders());
    onChanged();
  };

  const handleSelectProvider = (id: string) => {
    setActiveProviderId(id);
    setSelectedProviderId(id);
    onChanged();
  };


  const handleConfirmDeleteProvider = () => {
    if (!providerToDelete) return;
    if (editingProviderId === providerToDelete.id) {
      setEditingProviderId(null);
    }
    removeCustomProvider(providerToDelete.id);
    refresh();
    setSelectedProviderId(getActiveProviderId());
    setProviderToDelete(null);
  };


  const activeProviderObj =
    providersList.find((p) => p.id === selectedProviderId) || providersList[0];
  const providerLabel = (prov?: TranslationProviderConfig) => getProviderDisplayName(prov, isAr);
  // Definite key/account problems (invalid key, exhausted quota) stick on the provider card.
  const providerRuntimeErrors = useSyncExternalStore(subscribeModelLists, getProviderRuntimeErrorsSnapshot);

  return (
    <>
        <div className="flex flex-col shrink-0 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] bg-slate-50/70 dark:bg-[#1B212E] transition-all">
          <button
            id="drawer-translate-providers-btn"
            type="button"
            onClick={() => setProvidersPanelOpen((prev) => !prev)}
            className={`w-full flex items-center justify-between gap-2 px-4 py-3 ${
              providersPanelOpen ? 'rounded-t-2xl' : 'rounded-2xl'
            } bg-slate-100/90 hover:bg-slate-200/70 dark:bg-[#202634] dark:hover:bg-[#2A3244] text-slate-800 dark:text-slate-100 text-sm font-medium transition cursor-pointer text-left`}
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden">
              <Cpu className="w-4 h-4 text-[#1EB996] shrink-0" />
              <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                <span data-i18n className="w-full text-xs sm:text-sm font-semibold truncate">
                  {t('translate_providers')}
                </span>
                <span className="w-full text-[11px] text-[#1EB996] font-medium truncate">
                  {providerLabel(activeProviderObj)}
                </span>
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
                providersPanelOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {providersPanelOpen && (
            <div className="p-3 flex flex-col gap-3 border-t border-slate-200/80 dark:border-[#2A3244]">
              {gtxDown && (
                <p data-i18n
                  role="status"
                  className="text-[11px] leading-snug rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-2"
                >
                  {t('the_free_google_engine_is')}
                </p>
              )}

              {/* Providers Selection List */}
              <div className="flex flex-col gap-1.5">
                <span data-i18n className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 px-1">
                  {t('select_provider_for_suggest')}
                </span>

                <div className="flex flex-col gap-1.5 pe-0.5">
                  {providersList.map((prov) => (
                    <ProviderListItem
                      key={prov.id}
                      provider={prov}
                      label={providerLabel(prov)}
                      isSelected={prov.id === selectedProviderId}
                      isEditing={editingProviderId === prov.id}
                      runtimeError={providerRuntimeErrors.get(prov.id)}
                      onSelect={() => handleSelectProvider(prov.id)}
                      onToggleEdit={() => setEditingProviderId((id) => (id === prov.id ? null : prov.id))}
                      onCloseEdit={() => setEditingProviderId(null)}
                      onDelete={() => setProviderToDelete(prov)}
                      refresh={refresh}
                    />
                  ))}
                </div>
              </div>

              {/* Toggle Add Custom API Key Section */}
              <div className="pt-2 border-t border-slate-200/70 dark:border-[#262E3E] flex flex-col gap-2.5">
                <button
                  id="drawer-toggle-add-apikey-btn"
                  type="button"
                  onClick={() => setShowAddKeyForm((open) => !open)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-200/70 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2D374B] text-slate-800 dark:text-slate-200 text-xs font-semibold transition cursor-pointer shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#1EB996]" />
                  <span data-i18n>
                    {t('add_translator_api_key')}
                  </span>
                  <Plus
                    className={`w-3.5 h-3.5 transition-transform ${
                      showAddKeyForm ? 'rotate-45' : ''
                    }`}
                  />
                </button>

                <AddProviderForm open={showAddKeyForm} isAr={isAr} onAdded={(id) => { refresh(); setSelectedProviderId(id); }} />
              </div>
            </div>
          )}
        </div>

        {!providersPanelOpen && (
          <ActiveProviderControls activeProviderObj={activeProviderObj} refresh={refresh} targetLang={targetLang} />
        )}
      {providerToDelete && (
        <DeleteProviderDialog
          provider={providerToDelete}
          onCancel={() => setProviderToDelete(null)}
          onConfirm={handleConfirmDeleteProvider}
        />
      )}
    </>
  );
};
