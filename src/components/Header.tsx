import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Upload,
  Download,
  Sparkles,
  Languages,
  Layers,
  LayoutList,
  Globe,
  ChevronDown,
  List,
  X,
  Palette,
  Check,
  KeyRound,
  Trash2,
  Pencil,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Cpu,
  RotateCcw,
  Keyboard,
  BarChart3,
  ShieldAlert,
  ShieldCheck,
  Braces,
  Code2,
} from 'lucide-react';
import { TranslationProject } from '../types';
import { analyzeProjectQa } from '../utils/placeholderCheck';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineBadge } from './OfflineBadge';
import {
  TranslationProviderConfig,
  ProviderEngineType,
  ProviderTestResult,
  getAllTranslationProviders,
  getActiveProviderId,
  setActiveProviderId,
  addCustomProvider,
  updateCustomProvider,
  removeCustomProvider,
  testProviderApiKey,
} from '../utils/translator';

const ACCENT_COLORS = [
  { id: 'teal', label: 'Teal', swatchClass: 'bg-emerald-500' },
  { id: 'blue', label: 'Blue', swatchClass: 'bg-blue-500' },
  { id: 'violet', label: 'Violet', swatchClass: 'bg-violet-500' },
  { id: 'rose', label: 'Rose', swatchClass: 'bg-rose-500' },
  { id: 'amber', label: 'Amber', swatchClass: 'bg-amber-500' },
  { id: 'cyan', label: 'Cyan', swatchClass: 'bg-cyan-500' },
] as const;

type AccentColorId = (typeof ACCENT_COLORS)[number]['id'];

const APP_LANGUAGES = [
  { code: 'ar' as const, label: 'العربية' },
  { code: 'en' as const, label: 'English' },
];

const ENGINE_OPTIONS: Array<{ value: string; nameEn: string; nameAr: string; labelAr: string; labelEn: string }> = [
  { value: 'auto', nameEn: '', nameAr: '', labelAr: 'تعرف تلقائي على المزود (Auto-Detect)', labelEn: 'Auto-Detect Provider' },
  { value: 'lara', nameEn: 'Lara Translate', nameAr: 'Lara Translate', labelAr: 'Lara Translate AI (Translated)', labelEn: 'Lara Translate AI (Translated)' },
  { value: 'yandex', nameEn: 'Yandex AI', nameAr: 'Yandex AI', labelAr: 'Yandex AI / Translate', labelEn: 'Yandex AI / Translate' },
  { value: 'deepl', nameEn: 'DeepL API', nameAr: 'DeepL API', labelAr: 'DeepL API', labelEn: 'DeepL API' },
  { value: 'gemini', nameEn: 'Google Gemini AI', nameAr: 'Google Gemini AI', labelAr: 'Google Gemini AI', labelEn: 'Google Gemini AI' },
  { value: 'openai', nameEn: 'OpenAI GPT', nameAr: 'OpenAI GPT', labelAr: 'OpenAI (GPT)', labelEn: 'OpenAI (GPT)' },
  { value: 'google_cloud', nameEn: 'Google Cloud Translate', nameAr: 'Google Cloud Translate', labelAr: 'Google Cloud Translation', labelEn: 'Google Cloud Translation' },
  { value: 'microsoft', nameEn: 'Microsoft Translator', nameAr: 'Microsoft Translator', labelAr: 'Microsoft Azure Translator', labelEn: 'Microsoft Azure Translator' },
];

interface HeaderProps {
  project: TranslationProject;
  activeView: 'editor' | 'table';
  onViewChange: (view: 'editor' | 'table') => void;
  onOpenImport: () => void;
  onOpenExport: () => void;
  onLoadSample: () => void;
  onLanguageChange: (locale: string) => void;
  onOpenLanguageModal?: () => void;
  appLang?: 'ar' | 'en';
  onAppLangChange?: (lang: 'ar' | 'en') => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  undoCount?: number;
  redoCount?: number;
  autoTranslate?: boolean;
  onToggleAutoTranslate?: (enabled: boolean) => void;
  onResetItemHistory?: (id: string) => void;
  onSelectString?: (id: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  project,
  activeView,
  onViewChange,
  onOpenImport,
  onOpenExport,
  onLoadSample,
  onOpenLanguageModal,
  appLang = 'ar',
  onAppLangChange,
  autoTranslate = false,
  onToggleAutoTranslate,
  onResetItemHistory,
  onSelectString,
}) => {
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [appLangMenuOpen, setAppLangMenuOpen] = useState(false);
  const [historyListExpanded, setHistoryListExpanded] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'ai' | 'manual'>('all');
  const [qaDrawerExpanded, setQaDrawerExpanded] = useState(false);
  const [qaDrawerFilter, setQaDrawerFilter] = useState<'all' | 'placeholder' | 'html'>('all');
  const isAr = appLang === 'ar';

  const qaSummary = useMemo(() => analyzeProjectQa(project.items), [project.items]);
  const filteredQaIssues = useMemo(() => {
    return qaSummary.allIssues.filter((iss) => {
      if (qaDrawerFilter === 'placeholder') return iss.category === 'placeholder';
      if (qaDrawerFilter === 'html') return iss.category === 'html';
      return true;
    });
  }, [qaSummary.allIssues, qaDrawerFilter]);

  const translatedItems = project.items.filter((i) => i.status !== 'untranslated');
  const aiTranslatedCount = translatedItems.filter((i) => i.translationSource === 'ai').length;
  const manualTranslatedCount = translatedItems.filter((i) => i.translationSource !== 'ai').length;
  const totalTranslatedCount = translatedItems.length;
  const aiPercent =
    totalTranslatedCount > 0 ? Math.round((aiTranslatedCount / totalTranslatedCount) * 100) : 0;
  const manualPercent = totalTranslatedCount > 0 ? 100 - aiPercent : 0;
  const filteredHistoryItems = translatedItems.filter((item) => {
    if (historyFilter === 'ai') return item.translationSource === 'ai';
    if (historyFilter === 'manual') return item.translationSource !== 'ai';
    return true;
  });
  const [accentColor, setAccentColor] = useState<AccentColorId>(() => {
    const saved = localStorage.getItem('app_accent_color') as AccentColorId | null;
    if (saved && ACCENT_COLORS.some((c) => c.id === saved)) {
      return saved;
    }
    return 'teal';
  });

  // Translation Providers state inside the sidebar
  const [providersPanelOpen, setProvidersPanelOpen] = useState(false);
  const [providersList, setProvidersList] = useState<TranslationProviderConfig[]>(() =>
    getAllTranslationProviders()
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => getActiveProviderId());

  // Add new API key form state
  const [showAddKeyForm, setShowAddKeyForm] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderEngine, setNewProviderEngine] = useState<string>('auto');
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const addKeyFormRef = useRef<HTMLFormElement | null>(null);
  const providerNameInputRef = useRef<HTMLInputElement | null>(null);

  // Confirm delete dialog state
  const [providerToDelete, setProviderToDelete] = useState<TranslationProviderConfig | null>(null);

  // Edit existing custom provider state
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editProviderName, setEditProviderName] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editApiSecret, setEditApiSecret] = useState('');
  const [isTestingEditKey, setIsTestingEditKey] = useState(false);
  const [editTestResult, setEditTestResult] = useState<ProviderTestResult | null>(null);
  const editNameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accentColor);
    localStorage.setItem('app_accent_color', accentColor);
  }, [accentColor]);

  const handleCycleAccentColor = () => {
    const currentIndex = ACCENT_COLORS.findIndex((c) => c.id === accentColor);
    const nextIndex = (currentIndex + 1) % ACCENT_COLORS.length;
    setAccentColor(ACCENT_COLORS[nextIndex].id);
  };

  const handleSelectProvider = (id: string) => {
    setActiveProviderId(id);
    setSelectedProviderId(id);
  };

  const inferEngineFromName = (typedName: string, selectedEngine: string): string => {
    if (selectedEngine && selectedEngine !== 'auto') return selectedEngine;
    const lower = typedName.trim().toLowerCase();
    if (lower.includes('lara') || lower.includes('لارا') || lower.includes('translated')) return 'lara';
    if (lower.includes('yandex') || lower.includes('ياندكس')) return 'yandex';
    if (lower.includes('deepl') || lower.includes('ديب')) return 'deepl';
    if (lower.includes('gemini') || lower.includes('جيميني')) return 'gemini';
    if (lower.includes('openai') || lower.includes('gpt') || lower.includes('chatgpt')) return 'openai';
    if (lower.includes('microsoft') || lower.includes('azure') || lower.includes('bing')) return 'microsoft';
    if (lower.includes('google') || lower.includes('جوجل')) return 'google_cloud';
    return 'auto';
  };

  const handleTestAndAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newApiKey.trim()) return;

    setIsTestingKey(true);
    setTestResult(null);

    const effectiveEngine = inferEngineFromName(newProviderName, newProviderEngine);
    const rawKey = newApiKey.trim();
    const rawSecret = newApiSecret.trim();
    const combinedApiKey =
      effectiveEngine === 'lara' && rawSecret && !rawKey.includes(':')
        ? `${rawKey}:${rawSecret}`
        : rawKey;

    const result = await testProviderApiKey(effectiveEngine, combinedApiKey);
    setIsTestingKey(false);
    setTestResult(result);

    if (result.success && result.matched) {
      const detectedType: ProviderEngineType =
        result.detectedType ||
        (effectiveEngine !== 'auto' ? (effectiveEngine as ProviderEngineType) : 'yandex');

      const defaultNameMap: Record<string, string> = {
        lara: 'Lara Translate',
        yandex: 'Yandex AI',
        deepl: 'DeepL',
        gemini: 'Gemini AI',
        openai: 'OpenAI GPT',
        google_cloud: 'Google Cloud',
        microsoft: 'Microsoft Translator',
      };

      const finalName =
        newProviderName.trim() || `${defaultNameMap[detectedType] || 'Custom'} API`;

      const added = addCustomProvider({
        name: finalName,
        type: detectedType,
        apiKey: combinedApiKey,
      });

      setProvidersList(getAllTranslationProviders());
      setSelectedProviderId(added.id);
      setNewProviderName('');
      setNewApiKey('');
      setNewApiSecret('');
    }
  };

  const handleStartEditProvider = (prov: TranslationProviderConfig) => {
    if (editingProviderId === prov.id) {
      setEditingProviderId(null);
      setEditTestResult(null);
      return;
    }
    setEditingProviderId(prov.id);
    setEditProviderName(prov.name);
    const savedKey = prov.apiKey || '';
    if (prov.type === 'lara' && savedKey.includes(':') && !savedKey.endsWith(':fx')) {
      const sepIdx = savedKey.indexOf(':');
      setEditApiKey(savedKey.slice(0, sepIdx));
      setEditApiSecret(savedKey.slice(sepIdx + 1));
    } else {
      setEditApiKey(savedKey);
      setEditApiSecret('');
    }
    setEditTestResult(null);
    setTimeout(() => {
      editNameInputRef.current?.focus();
    }, 60);
  };

  const handleSaveEditedProvider = async (
    e: React.FormEvent,
    prov: TranslationProviderConfig
  ) => {
    e.preventDefault();
    const trimmedName = editProviderName.trim() || prov.name;
    const rawKey = editApiKey.trim();
    const rawSecret = editApiSecret.trim();
    if (!rawKey) return;

    const inferredEngine = inferEngineFromName(trimmedName, 'auto');
    const targetEngine =
      inferredEngine !== 'auto' ? (inferredEngine as ProviderEngineType) : prov.type;

    const combinedKey =
      targetEngine === 'lara' && rawSecret && !rawKey.includes(':')
        ? `${rawKey}:${rawSecret}`
        : rawKey;

    const keyChanged = combinedKey !== (prov.apiKey || '').trim();

    // If only the provider name was changed, save immediately without re-running network verification
    if (!keyChanged) {
      updateCustomProvider(prov.id, {
        name: trimmedName,
        type: targetEngine,
      });
      setProvidersList(getAllTranslationProviders());
      setEditingProviderId(null);
      setEditTestResult(null);
      return;
    }

    // If the API key was modified, verify the new API key against Google Translate first
    setIsTestingEditKey(true);
    setEditTestResult(null);

    const result = await testProviderApiKey(targetEngine, combinedKey);
    setIsTestingEditKey(false);
    setEditTestResult(result);

    if (result.success && result.matched) {
      const detectedType: ProviderEngineType = result.detectedType || targetEngine;
      updateCustomProvider(prov.id, {
        name: trimmedName,
        apiKey: combinedKey,
        type: detectedType,
      });
      setProvidersList(getAllTranslationProviders());
      setEditingProviderId(null);
      setEditTestResult(null);
    }
  };

  const handleConfirmDeleteProvider = () => {
    if (!providerToDelete) return;
    if (editingProviderId === providerToDelete.id) {
      setEditingProviderId(null);
    }
    removeCustomProvider(providerToDelete.id);
    setProvidersList(getAllTranslationProviders());
    setSelectedProviderId(getActiveProviderId());
    setProviderToDelete(null);
  };

  const activeProviderObj =
    providersList.find((p) => p.id === selectedProviderId) || providersList[0];

  // Compute translation statistics
  const totalItems = project.items.length;
  let translatedCount = 0;
  let needsReviewCount = 0;
  let untranslatedCount = 0;

  for (const item of project.items) {
    if (item.status === 'translated') {
      translatedCount++;
    } else if (item.status === 'needs_review') {
      needsReviewCount++;
    } else {
      untranslatedCount++;
    }
  }

  const translatedPercent = totalItems > 0 ? Math.round((translatedCount / totalItems) * 100) : 0;
  const reviewPercent = totalItems > 0 ? Math.round((needsReviewCount / totalItems) * 100) : 0;
  const untranslatedPercent = totalItems > 0 ? Math.max(0, 100 - translatedPercent - reviewPercent) : 0;
  const exactTranslatedWidth = totalItems > 0 ? (translatedCount / totalItems) * 100 : 0;
  const exactReviewWidth = totalItems > 0 ? (needsReviewCount / totalItems) * 100 : 0;

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#131314]/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 transition-colors">
        {/* Material 3 Top App Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-13 sm:h-14 flex items-center justify-between gap-4">
          {/* Brand & File Information */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#0B57D0] dark:bg-[#A8C7FA] flex items-center justify-center text-white dark:text-[#062E6F] shadow-xs shrink-0 transition-transform active:scale-95">
              <Languages className="w-4.5 h-4.5 stroke-[2.25]" />
            </div>

            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-1.5">
                <h1 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight truncate">
                  {isAr ? 'مترجم XML' : 'XML Translator'}
                </h1>
              </div>
            </div>
          </div>

          {/* Center / Navigation Controls */}
          <div className="hidden md:flex items-center gap-3">
            {/* M3 Segmented Button for View Switching */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800/90 rounded-full p-1 border border-slate-200/60 dark:border-slate-700/60">
              <button
                id="view-editor-btn"
                onClick={() => onViewChange('editor')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer ${
                  activeView === 'editor'
                    ? 'bg-white dark:bg-[#282B30] text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{isAr ? 'المحرّر' : 'Editor'}</span>
              </button>
              <button
                id="view-table-btn"
                onClick={() => onViewChange('table')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer ${
                  activeView === 'table'
                    ? 'bg-white dark:bg-[#282B30] text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                <span>{isAr ? 'جميع النصوص' : 'All Strings'}</span>
              </button>
            </div>

            {/* M3 Target Language Selector Pill */}
            <div className="relative inline-flex items-center">
              <button
                id="header-open-lang-modal-btn"
                onClick={onOpenLanguageModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800/90 border border-slate-200/60 dark:border-slate-700/60 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition cursor-pointer shadow-xs group"
                title={isAr ? 'تغيير لغة الترجمة' : 'Switch Target Language'}
              >
                <Globe className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA] group-hover:rotate-12 transition-transform" />
                <span className="font-semibold">{project.targetLocaleName || project.targetLang}</span>
                <span className="font-mono text-[10px] text-slate-400 bg-black/10 dark:bg-black/30 px-1.5 py-0.5 rounded">
                  values-{project.targetLang}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-200" />
              </button>
            </div>
          </div>

          {/* Right Actions - Far Right List Icon Button */}
          <div className="flex items-center gap-2 shrink-0">
            <OfflineBadge />

            <PWAInstallButton />

            <button
              id="header-load-sample-btn"
              onClick={onLoadSample}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium transition cursor-pointer m3-state-layer"
              title={isAr ? 'تحميل ملف strings.xml تجريبي' : 'Load sample Android strings.xml'}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>{isAr ? 'مثال' : 'Sample'}</span>
            </button>

            {/* Table / Editor View Switch Button next to the top-right Sidebar Button */}
            <button
              id="header-mobile-view-toggle-btn"
              type="button"
              onClick={() => onViewChange(activeView === 'editor' ? 'table' : 'editor')}
              className="md:hidden inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 text-xs font-medium transition cursor-pointer m3-state-layer"
              title={
                activeView === 'editor'
                  ? isAr
                    ? 'التبديل إلى عرض الجدول'
                    : 'Switch to Table View'
                  : isAr
                    ? 'التبديل إلى عرض المحرّر'
                    : 'Switch to Editor View'
              }
            >
              {activeView === 'editor' ? (
                <>
                  <LayoutList className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                  <span>{isAr ? 'الجدول' : 'Table'}</span>
                </>
              ) : (
                <>
                  <Layers className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                  <span>{isAr ? 'المحرّر' : 'Editor'}</span>
                </>
              )}
            </button>

            {/* Far Right List Icon Button to Open Right Drawer */}
            <button
              id="header-right-drawer-btn"
              type="button"
              onClick={() => {
                setAppLangMenuOpen(false);
                setRightDrawerOpen(true);
              }}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 transition cursor-pointer m3-state-layer"
              title={isAr ? 'فتح القائمة الجانبية' : 'Open Sidebar Menu'}
              aria-label="Open Actions Menu"
            >
              <List className="w-4.5 h-4.5 text-slate-700 dark:text-slate-200" />
            </button>
          </div>
        </div>

        {/* Visual Progress Bar & Translated vs. Untranslated Breakdown */}
        <div className="px-4 sm:px-6 py-2 bg-slate-50/80 dark:bg-[#171A21]/90 border-t border-slate-200/60 dark:border-slate-800/70">
          <div className="max-w-7xl mx-auto flex flex-col gap-1.5">
            {/* Segmented Progress Track (SVG avoids inline style while supporting exact dynamic percentages) */}
            <div
              role="progressbar"
              aria-valuenow={translatedPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Translation progress: ${translatedPercent}% translated, ${untranslatedPercent}% untranslated`}
              className="w-full h-2 rounded-full bg-slate-200/90 dark:bg-slate-800 overflow-hidden shadow-inner"
            >
              <svg
                viewBox="0 0 100 8"
                preserveAspectRatio="none"
                className="w-full h-full block"
              >
                {/* Untranslated background track */}
                <rect
                  x={0}
                  y={0}
                  width={100}
                  height={8}
                  className="fill-slate-200 dark:fill-slate-800"
                />
                {/* Translated segment */}
                <rect
                  x={0}
                  y={0}
                  width={exactTranslatedWidth}
                  height={8}
                  className="fill-[#1EB996] transition-all duration-300 ease-out"
                />
                {/* Needs Review segment */}
                {exactReviewWidth > 0 && (
                  <rect
                    x={exactTranslatedWidth}
                    y={0}
                    width={exactReviewWidth}
                    height={8}
                    className="fill-amber-400 transition-all duration-300 ease-out"
                  />
                )}
              </svg>
            </div>

            {/* Breakdown Legend & Mobile View Switcher */}
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Translated stat */}
                <div className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#1EB996] shrink-0" />
                  <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {translatedPercent}% {isAr ? 'مترجم' : 'Translated'}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500 tabular-nums">
                    ({translatedCount}/{totalItems})
                  </span>
                </div>

                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>

                {/* Untranslated stat */}
                <div className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                  <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                    {untranslatedPercent}% {isAr ? 'غير مترجم' : 'Untranslated'}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500 tabular-nums">
                    ({untranslatedCount})
                  </span>
                </div>

                {/* Needs review stat (if any) */}
                {needsReviewCount > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                    <div className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-amber-700 dark:text-amber-300 font-medium tabular-nums">
                        {reviewPercent}% {isAr ? 'مراجعة' : 'Review'} ({needsReviewCount})
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Right-Side Slide-Out Drawer for Import & Export */}
      {rightDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => {
              setAppLangMenuOpen(false);
              setRightDrawerOpen(false);
            }}
          />

          {/* Drawer Content on the Right Side */}
          <aside className="relative w-72 sm:w-80 max-w-[85vw] h-dvh max-h-dvh overflow-hidden bg-white dark:bg-[#161922] border-l border-slate-200 dark:border-[#252C3A] shadow-2xl z-10 flex flex-col animate-in slide-in-from-right duration-200">
            {/* Drawer Header: App Language Icon Button (Arabic/English only) + Icon-Only Accent Button & Swatches */}
            <div className="relative flex items-center justify-between gap-2 px-4 py-3.5 border-b border-slate-200/80 dark:border-[#252C3A]">
              <div className="flex items-center gap-1.5 min-w-0">
                {/* App Language Icon Button (Far Left) */}
                <div className="relative">
                  <button
                    id="drawer-language-btn"
                    type="button"
                    onClick={() => setAppLangMenuOpen((prev) => !prev)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-[#202634] dark:hover:bg-[#2A3244] border border-slate-200/80 dark:border-[#2F384B] text-slate-800 dark:text-slate-100 transition cursor-pointer shrink-0"
                    title={isAr ? 'تغيير لغة التطبيق (العربية / English)' : 'Change App Language (العربية / English)'}
                    aria-label="Change app language"
                  >
                    <Languages className="w-4 h-4 text-[#1EB996]" />
                  </button>

                  {/* App Language Dropdown Menu (Only Arabic & English) */}
                  {appLangMenuOpen && (
                    <div className="absolute left-0 top-full mt-2 w-40 rounded-xl bg-white dark:bg-[#1B2230] border border-slate-200 dark:border-[#2F384B] shadow-xl py-1.5 z-30">
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-[#262E3E] mb-1">
                        {isAr ? 'لغة التطبيق' : 'App Language'}
                      </div>
                      {APP_LANGUAGES.map((lang) => {
                        const isSelected = appLang === lang.code;
                        return (
                          <button
                            key={lang.code}
                            type="button"
                            onClick={() => {
                              onAppLangChange?.(lang.code);
                              setAppLangMenuOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-xs flex items-center justify-between transition cursor-pointer ${
                              isSelected
                                ? 'bg-slate-100 dark:bg-[#252F42] text-slate-900 dark:text-white font-semibold'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#212A3A]'
                            }`}
                          >
                            <span>{lang.label}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-[#1EB996]" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Icon-Only Accent Color Button */}
                <button
                  id="drawer-accent-color-btn"
                  type="button"
                  onClick={handleCycleAccentColor}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-[#202634] dark:hover:bg-[#2A3244] border border-slate-200/80 dark:border-[#2F384B] text-slate-800 dark:text-slate-100 transition cursor-pointer shrink-0"
                  title={isAr ? 'تغيير لون التمييز' : 'Change app accent color'}
                  aria-label="Change app accent color"
                >
                  <Palette className="w-4 h-4 text-[#1EB996]" />
                </button>

                {/* Direct Accent Color Swatches */}
                <div className="flex items-center gap-1 ml-0.5">
                  {ACCENT_COLORS.map((c) => {
                    const isSelected = accentColor === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setAccentColor(c.id)}
                        className={`w-4.5 h-4.5 rounded-full ${c.swatchClass} transition-transform cursor-pointer flex items-center justify-center ${
                          isSelected
                            ? 'ring-2 ring-offset-1 ring-slate-900 dark:ring-white dark:ring-offset-[#161922] scale-110'
                            : 'opacity-75 hover:opacity-100 hover:scale-105'
                        }`}
                        title={`${c.label} accent`}
                        aria-label={`Set ${c.label} accent color`}
                      />
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAppLangMenuOpen(false);
                  setRightDrawerOpen(false);
                }}
                className="p-1.5 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Close drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body: Import, Export, and Translate Providers Button */}
            <div className="p-5 pb-28 flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y flex flex-col gap-3">
              {/* Import Button */}
              <button
                id="drawer-import-btn"
                type="button"
                onClick={() => {
                  setAppLangMenuOpen(false);
                  setRightDrawerOpen(false);
                  onOpenImport();
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200/80 dark:bg-[#202634] dark:hover:bg-[#2A3244] border border-slate-200/80 dark:border-[#2F384B] text-slate-800 dark:text-slate-100 text-sm font-medium transition cursor-pointer shadow-xs shrink-0"
              >
                <Upload className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                <span>{isAr ? 'استيراد' : 'Import'}</span>
              </button>

              {/* Export Button */}
              <button
                id="drawer-export-btn"
                type="button"
                onClick={() => {
                  setAppLangMenuOpen(false);
                  setRightDrawerOpen(false);
                  onOpenExport();
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#1EB996] dark:hover:bg-[#19A585] text-white text-sm font-semibold shadow-sm transition cursor-pointer shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>{isAr ? 'تصدير XML' : 'Export XML'}</span>
              </button>

              {/* Translate Providers Button (Under Export Button) */}
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
                      <span className="w-full text-xs sm:text-sm font-semibold truncate">
                        {isAr ? 'مزودو الترجمة (Suggest)' : 'Translate Providers'}
                      </span>
                      <span className="w-full text-[11px] text-[#1EB996] font-medium truncate">
                        {activeProviderObj?.name || 'Gemini AI'}
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
                    {/* Providers Selection List */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                        {isAr ? 'اختر مزود الترجمة لزر الاقتراح' : 'Select Provider for Suggest'}
                      </span>

                      <div className="flex flex-col gap-1.5 pr-0.5">
                        {providersList.map((prov) => {
                          const isSelected = prov.id === selectedProviderId;
                          const isEditing = editingProviderId === prov.id;
                          return (
                            <div
                              key={prov.id}
                              className={`flex flex-col rounded-xl px-2.5 py-2 border transition shrink-0 ${
                                isSelected
                                  ? 'bg-[#1EB996]/12 border-[#1EB996]/50 text-slate-900 dark:text-white'
                                  : 'bg-white/80 dark:bg-[#151A24] border-slate-200/70 dark:border-[#262E3E] text-slate-700 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-[#1E2534]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSelectProvider(prov.id)}
                                  className="flex-1 flex items-center justify-between gap-2 text-left min-w-0 cursor-pointer"
                                >
                                  <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-semibold truncate">{prov.name}</span>
                                      {!prov.isBuiltIn && (
                                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#1EB996]/15 text-[#1EB996] border border-[#1EB996]/30 shrink-0">
                                          API
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                      {prov.type === 'lara'
                                        ? isAr
                                          ? 'محرك Lara AI للترجمة'
                                          : 'Lara Translate AI'
                                        : prov.type === 'yandex_builtin' || prov.type === 'yandex'
                                          ? isAr
                                            ? 'محرك Yandex الذكي'
                                            : 'Yandex AI Translator'
                                          : prov.type === 'gemini'
                                            ? isAr
                                              ? 'ذكاء اصطناعي (Gemini)'
                                              : 'Gemini AI Engine'
                                            : prov.type === 'google' || prov.type === 'google_cloud'
                                              ? isAr
                                                ? 'ترجمة Google العصبية'
                                                : 'Google Neural Translate'
                                              : prov.type === 'deepl'
                                                ? 'DeepL Neural MT'
                                                : prov.type === 'openai'
                                                  ? 'OpenAI GPT Translator'
                                                  : prov.type === 'microsoft'
                                                    ? 'Microsoft Azure MT'
                                                    : isAr
                                                      ? 'ذاكرة الترجمة (MyMemory)'
                                                      : 'MyMemory TM'}
                                    </span>
                                  </div>
                                  {isSelected && <Check className="w-4 h-4 text-[#1EB996] shrink-0" />}
                                </button>

                                {/* Edit & Trash Icons for custom API key providers */}
                                {!prov.isBuiltIn && (
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStartEditProvider(prov);
                                      }}
                                      className={`p-1.5 rounded-lg transition cursor-pointer shrink-0 ${
                                        isEditing
                                          ? 'text-[#1EB996] bg-[#1EB996]/15'
                                          : 'text-slate-400 hover:text-[#1EB996] hover:bg-[#1EB996]/10'
                                      }`}
                                      title={isAr ? 'تعديل الاسم أو مفتاح API' : 'Edit name or API key'}
                                      aria-label={`Edit ${prov.name}`}
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProviderToDelete(prov);
                                      }}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer shrink-0"
                                      title={isAr ? 'حذف مزود الترجمة' : 'Delete provider'}
                                      aria-label={`Delete ${prov.name}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Inline Edit Form for Custom Provider Name & API Key */}
                              {!prov.isBuiltIn && isEditing && (
                                <form
                                  onSubmit={(e) => handleSaveEditedProvider(e, prov)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-2.5 pt-2.5 border-t border-slate-200/80 dark:border-[#262E3E] flex flex-col gap-2.5"
                                >
                                  <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      {isAr ? 'تعديل اسم المزود' : 'Edit Provider Name'}
                                    </label>
                                    <div className="relative flex items-center">
                                      <input
                                        ref={editNameInputRef}
                                        type="text"
                                        autoComplete="off"
                                        value={editProviderName}
                                        onChange={(e) => setEditProviderName(e.target.value)}
                                        onKeyDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        placeholder={isAr ? 'اسم المزود...' : 'Provider name...'}
                                        required
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                                      />
                                      {editProviderName && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditProviderName('');
                                            editNameInputRef.current?.focus();
                                          }}
                                          className="absolute right-2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                          aria-label="Clear edited provider name"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      {prov.type === 'lara' ||
                                      inferEngineFromName(editProviderName, 'auto') === 'lara'
                                        ? isAr
                                          ? 'معرّف مفتاح Lara (Access Key ID أو ID:Secret)'
                                          : 'Lara Access Key ID (or ID:Secret)'
                                        : isAr
                                          ? 'تعديل مفتاح API'
                                          : 'Edit API Key'}
                                    </label>
                                    <input
                                      type="text"
                                      autoComplete="off"
                                      value={editApiKey}
                                      onChange={(e) => setEditApiKey(e.target.value)}
                                      onKeyDown={(e) => e.stopPropagation()}
                                      onTouchStart={(e) => e.stopPropagation()}
                                      placeholder={
                                        prov.type === 'lara' ||
                                        inferEngineFromName(editProviderName, 'auto') === 'lara'
                                          ? isAr
                                            ? 'Access Key ID (أو ID:Secret)...'
                                            : 'Access Key ID (or ID:Secret)...'
                                          : isAr
                                            ? 'مفتاح API...'
                                            : 'API Key...'
                                      }
                                      required
                                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                                    />
                                  </div>

                                  {(prov.type === 'lara' ||
                                    inferEngineFromName(editProviderName, 'auto') === 'lara') && (
                                    <div className="flex flex-col gap-1">
                                      <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                        {isAr
                                          ? 'سر مفتاح Lara (Access Key Secret)'
                                          : 'Lara Access Key Secret'}
                                      </label>
                                      <input
                                        type="text"
                                        autoComplete="off"
                                        value={editApiSecret}
                                        onChange={(e) => setEditApiSecret(e.target.value)}
                                        onKeyDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        placeholder={
                                          isAr
                                            ? 'Access Key Secret (اختياري إذا كان مدمجاً أعلاه)...'
                                            : 'Access Key Secret (optional if ID:Secret above)...'
                                        }
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                                      />
                                    </div>
                                  )}

                                  {editTestResult && !editTestResult.matched && (
                                    <div className="p-2 rounded-lg border bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300 text-[10px] flex flex-col gap-1">
                                      <div className="flex items-center gap-1 font-semibold">
                                        <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                        <span>
                                          {isAr
                                            ? 'فشل التحقق من مفتاح API الجديد'
                                            : 'New API key verification failed'}
                                        </span>
                                      </div>
                                      {editTestResult.error && (
                                        <p className="opacity-90 leading-snug">{editTestResult.error}</p>
                                      )}
                                    </div>
                                  )}

                                  <div className="flex items-center justify-end gap-1.5 pt-0.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingProviderId(null);
                                        setEditTestResult(null);
                                      }}
                                      className="px-2.5 py-1.5 rounded-lg bg-slate-200/70 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2E384B] text-slate-700 dark:text-slate-200 text-[11px] font-semibold transition cursor-pointer"
                                    >
                                      {isAr ? 'إلغاء' : 'Cancel'}
                                    </button>
                                    <button
                                      type="submit"
                                      disabled={
                                        isTestingEditKey ||
                                        !editProviderName.trim() ||
                                        !editApiKey.trim()
                                      }
                                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1EB996] hover:bg-[#19A585] disabled:opacity-50 text-white text-[11px] font-semibold transition cursor-pointer shadow-xs"
                                    >
                                      {isTestingEditKey ? (
                                        <>
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                          <span>{isAr ? 'جاري الفحص...' : 'Verifying...'}</span>
                                        </>
                                      ) : (
                                        <>
                                          <Check className="w-3 h-3" />
                                          <span>{isAr ? 'حفظ التعديلات' : 'Save Changes'}</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </form>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Toggle Add Custom API Key Section */}
                    <div className="pt-2 border-t border-slate-200/70 dark:border-[#262E3E] flex flex-col gap-2.5">
                      <button
                        id="drawer-toggle-add-apikey-btn"
                        type="button"
                        onClick={() => {
                          const nextOpen = !showAddKeyForm;
                          setShowAddKeyForm(nextOpen);
                          setTestResult(null);
                          if (nextOpen) {
                            setTimeout(() => {
                              addKeyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }, 80);
                          }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-200/70 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2D374B] text-slate-800 dark:text-slate-200 text-xs font-semibold transition cursor-pointer shrink-0"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-[#1EB996]" />
                        <span>
                          {isAr ? 'إضافة مفتاح API لمزود ترجمة' : 'Add Translator API Key'}
                        </span>
                        <Plus
                          className={`w-3.5 h-3.5 transition-transform ${
                            showAddKeyForm ? 'rotate-45' : ''
                          }`}
                        />
                      </button>

                      {showAddKeyForm && (
                        <form
                          ref={addKeyFormRef}
                          onSubmit={handleTestAndAddProvider}
                          className="flex flex-col gap-3 p-3 rounded-xl bg-white dark:bg-[#141821] border border-slate-200/80 dark:border-[#283142]"
                        >
                          {/* Provider Custom Name Input (Typable) */}
                          <div className="flex flex-col gap-1.5">
                            <label
                              htmlFor="provider-custom-name-input"
                              className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                            >
                              {isAr ? 'اسم المزود (اكتب الاسم أو اختر من القائمة أدناه)' : 'Provider Name (Type or swipe list below)'}
                            </label>
                            <div className="relative flex items-center">
                              <input
                                ref={providerNameInputRef}
                                id="provider-custom-name-input"
                                type="text"
                                autoComplete="off"
                                value={newProviderName}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setNewProviderName(val);
                                  const inferred = inferEngineFromName(val, 'auto');
                                  if (inferred !== 'auto') {
                                    setNewProviderEngine(inferred);
                                  }
                                }}
                                onKeyDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                placeholder={
                                  isAr ? 'اكتب اسم المزود (مثال: Yandex AI)...' : 'Type provider name (e.g. Yandex AI)...'
                                }
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                              />
                              {newProviderName && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewProviderName('');
                                    providerNameInputRef.current?.focus();
                                  }}
                                  className="absolute right-2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                  aria-label="Clear provider name"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Swipeable / Scrollable Provider Engine List */}
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                              {isAr ? 'اسحب القائمة لاختيار نوع المزود:' : 'Swipe list to choose provider engine:'}
                            </span>
                            <div
                              id="provider-swipe-list"
                              onTouchMove={(e) => e.stopPropagation()}
                              className="flex flex-col gap-1 max-h-36 overflow-y-auto overscroll-contain touch-pan-y p-1.5 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-200 dark:border-[#2E384D]"
                            >
                              {ENGINE_OPTIONS.map((opt) => {
                                const isSelectedEngine = newProviderEngine === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => {
                                      setNewProviderEngine(opt.value);
                                      if (opt.value !== 'auto') {
                                        const presetName = isAr ? opt.nameAr : opt.nameEn;
                                        if (presetName) {
                                          setNewProviderName(presetName);
                                        }
                                      }
                                    }}
                                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs text-left transition cursor-pointer shrink-0 ${
                                      isSelectedEngine
                                        ? 'bg-[#1EB996]/15 text-[#1EB996] font-semibold border border-[#1EB996]/40'
                                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#252E40]'
                                    }`}
                                  >
                                    <span className="truncate">{isAr ? opt.labelAr : opt.labelEn}</span>
                                    {isSelectedEngine && <Check className="w-3.5 h-3.5 text-[#1EB996] shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* API Key Input */}
                          <div className="flex flex-col gap-1.5">
                            <label
                              htmlFor="provider-api-key-input"
                              className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                            >
                              {inferEngineFromName(newProviderName, newProviderEngine) === 'lara'
                                ? isAr
                                  ? 'معرّف مفتاح Lara (Access Key ID أو ID:Secret)'
                                  : 'Lara Access Key ID (or ID:Secret)'
                                : isAr
                                  ? 'مفتاح API للمزود'
                                  : 'Translator API Key'}
                            </label>
                            <input
                              id="provider-api-key-input"
                              type="text"
                              autoComplete="off"
                              value={newApiKey}
                              onChange={(e) => setNewApiKey(e.target.value)}
                              onKeyDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              placeholder={
                                inferEngineFromName(newProviderName, newProviderEngine) === 'lara'
                                  ? isAr
                                    ? 'الصق Access Key ID (أو ID:Secret)...'
                                    : 'Paste Access Key ID (or ID:Secret)...'
                                  : isAr
                                    ? 'الصق مفتاح API هنا...'
                                    : 'Paste API key here...'
                              }
                              required
                              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                            />
                          </div>

                          {/* Optional Lara Access Key Secret Input when Lara Translate is selected */}
                          {inferEngineFromName(newProviderName, newProviderEngine) === 'lara' && (
                            <div className="flex flex-col gap-1.5">
                              <label
                                htmlFor="provider-api-secret-input"
                                className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                              >
                                {isAr
                                  ? 'سر مفتاح Lara (Access Key Secret)'
                                  : 'Lara Access Key Secret'}
                              </label>
                              <input
                                id="provider-api-secret-input"
                                type="text"
                                autoComplete="off"
                                value={newApiSecret}
                                onChange={(e) => setNewApiSecret(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                placeholder={
                                  isAr
                                    ? 'الصق Access Key Secret (اختياري إذا كتبت ID:Secret أعلاه)...'
                                    : 'Paste Access Key Secret (optional if ID:Secret above)...'
                                }
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                              />
                            </div>
                          )}

                          {/* Submit / Verify Key Button */}
                          <button
                            id="provider-verify-add-btn"
                            type="submit"
                            disabled={isTestingKey || !newApiKey.trim()}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#1EB996] hover:bg-[#19A585] disabled:opacity-50 text-white text-xs font-semibold transition cursor-pointer shadow-xs shrink-0"
                          >
                            {isTestingKey ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>
                                  {isAr
                                    ? 'جاري الاختبار والمقارنة مع Google...'
                                    : 'Testing & comparing with Google...'}
                                </span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>
                                  {isAr
                                    ? 'فحص المفتاح وإضافته للمزودين'
                                    : 'Verify & Add to Providers'}
                                </span>
                              </>
                            )}
                          </button>

                          {/* Verification & Google Comparison Result Box */}
                          {testResult && (
                            <div
                              className={`p-2.5 rounded-lg border text-[11px] flex flex-col gap-1.5 ${
                                testResult.success && testResult.matched
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-semibold">
                                {testResult.success && testResult.matched ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                    <span>
                                      {isAr
                                        ? 'المفتاح يعمل! تطابقت الترجمة وتمت الإضافة'
                                        : 'API Key works! Translation matched & added'}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                    <span>
                                      {isAr
                                        ? 'فشل التحقق من المفتاح'
                                        : 'API Key verification failed'}
                                    </span>
                                  </>
                                )}
                              </div>

                              {testResult.testSource && (
                                <div className="text-[10px] space-y-0.5 text-slate-600 dark:text-slate-300 bg-black/5 dark:bg-black/25 p-1.5 rounded">
                                  <div>
                                    <span className="opacity-70">
                                      {isAr ? 'نص الاختبار: ' : 'Test: '}
                                    </span>
                                    <span className="font-mono">{testResult.testSource}</span>
                                  </div>
                                  {testResult.googleTranslation && (
                                    <div>
                                      <span className="opacity-70">Google Translate: </span>
                                      <span className="font-semibold">
                                        {testResult.googleTranslation}
                                      </span>
                                    </div>
                                  )}
                                  {testResult.providerTranslation && (
                                    <div>
                                      <span className="opacity-70">
                                        {isAr ? 'ترجمة المزود: ' : 'Provider: '}
                                      </span>
                                      <span className="font-semibold">
                                        {testResult.providerTranslation}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {testResult.error && (
                                <p className="text-[10px] leading-snug opacity-90">
                                  {testResult.error}
                                </p>
                              )}
                            </div>
                          )}
                        </form>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Auto-Translate Option Toggle (Under Translate Providers) */}
              <button
                type="button"
                onClick={() => onToggleAutoTranslate?.(!autoTranslate)}
                role="switch"
                aria-checked={autoTranslate}
                id="drawer-auto-translate-toggle"
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition cursor-pointer shrink-0 select-none text-left ${
                  autoTranslate
                    ? 'bg-[#1EB996]/12 border-[#1EB996]/50 text-slate-900 dark:text-white'
                    : 'bg-slate-100/90 hover:bg-slate-200/70 dark:bg-[#202634] dark:hover:bg-[#2A3244] border-slate-200/90 dark:border-[#2F384B] text-slate-800 dark:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden">
                  <Sparkles
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      autoTranslate ? 'text-[#1EB996]' : 'text-slate-400 dark:text-slate-400'
                    }`}
                  />
                  <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                    <span className="w-full text-xs sm:text-sm font-semibold leading-snug truncate">
                      {isAr ? 'الترجمة التلقائية' : 'Auto Translate'}
                    </span>
                    <span className="w-full text-[11px] text-slate-500 dark:text-slate-400 leading-snug truncate">
                      {isAr
                        ? `ترجمة تلقائية عبر ${activeProviderObj?.name || 'Gemini AI'}`
                        : `Auto-translate via ${activeProviderObj?.name || 'Gemini AI'}`}
                    </span>
                  </div>
                </div>

                {/* Toggle Pill Switch */}
                <div
                  dir="ltr"
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
                    autoTranslate
                      ? 'bg-[#1EB996]'
                      : 'bg-slate-300 dark:bg-[#343E52]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      autoTranslate ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>

              {/* AI vs. Manual Translation Statistics & Individual History Reset Summary Section */}
              <div
                id="drawer-translation-stats-section"
                className="flex flex-col shrink-0 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] bg-slate-100/80 dark:bg-[#202634] p-3.5 gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <BarChart3 className="w-4 h-4 text-[#1EB996] shrink-0" />
                    <span className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {isAr ? 'إحصائيات الترجمة' : 'Translation Statistics'}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                    {totalTranslatedCount}/{project.items.length}
                  </span>
                </div>

                {/* AI vs. Manual Cards */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (historyListExpanded && historyFilter === 'ai') {
                        setHistoryListExpanded(false);
                        setHistoryFilter('all');
                      } else {
                        setHistoryFilter('ai');
                        setHistoryListExpanded(true);
                      }
                    }}
                    className={`flex flex-col gap-1 p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      historyFilter === 'ai' && historyListExpanded
                        ? 'bg-amber-500/15 border-amber-500/50 ring-1 ring-amber-500/30'
                        : 'bg-white dark:bg-[#171C27] border-slate-200/80 dark:border-[#2B3346] hover:border-amber-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="truncate">{isAr ? 'ذكاء اصطناعي' : 'AI Translated'}</span>
                      </span>
                      <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                        {aiPercent}%
                      </span>
                    </div>
                    <span className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
                      {aiTranslatedCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (historyListExpanded && historyFilter === 'manual') {
                        setHistoryListExpanded(false);
                        setHistoryFilter('all');
                      } else {
                        setHistoryFilter('manual');
                        setHistoryListExpanded(true);
                      }
                    }}
                    className={`flex flex-col gap-1 p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      historyFilter === 'manual' && historyListExpanded
                        ? 'bg-[#1EB996]/15 border-[#1EB996]/50 ring-1 ring-[#1EB996]/30'
                        : 'bg-white dark:bg-[#171C27] border-slate-200/80 dark:border-[#2B3346] hover:border-[#1EB996]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                        <Keyboard className="w-3.5 h-3.5 text-[#1EB996] shrink-0" />
                        <span className="truncate">{isAr ? 'إدخال يدوي' : 'Manual Input'}</span>
                      </span>
                      <span className="text-[10px] font-mono text-[#1EB996] tabular-nums">
                        {manualPercent}%
                      </span>
                    </div>
                    <span className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
                      {manualTranslatedCount}
                    </span>
                  </button>
                </div>

                {/* Progress Ratio Bar */}
                <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-[#141821] overflow-hidden flex">
                  {aiTranslatedCount > 0 && (
                    <div
                      style={{
                        width: `${(aiTranslatedCount / Math.max(1, project.items.length)) * 100}%`,
                      }}
                      className="h-full bg-amber-500 transition-all duration-300"
                    />
                  )}
                  {manualTranslatedCount > 0 && (
                    <div
                      style={{
                        width: `${(manualTranslatedCount / Math.max(1, project.items.length)) * 100}%`,
                      }}
                      className="h-full bg-[#1EB996] transition-all duration-300"
                    />
                  )}
                </div>

                {/* Expandable Individual Translation History & Reset List */}
                <div className="pt-1 border-t border-slate-200/70 dark:border-[#2B3346]">
                  <button
                    id="drawer-toggle-history-list-btn"
                    type="button"
                    onClick={() => {
                      setHistoryListExpanded((prev) => {
                        const next = !prev;
                        if (!next) setHistoryFilter('all');
                        return next;
                      });
                    }}
                    className="w-full flex items-center justify-between gap-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-[#1EB996] dark:hover:text-[#1EB996] transition cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">
                        {isAr
                          ? `سجل الترجمات وإعادة التعيين (${filteredHistoryItems.length})`
                          : `Translation History & Reset (${filteredHistoryItems.length})`}
                      </span>
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
                        historyListExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {historyListExpanded && (
                    <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                      {filteredHistoryItems.length === 0 ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center py-3">
                          {isAr ? 'لا توجد نصوص مترجمة حالياً' : 'No translated strings yet'}
                        </p>
                      ) : (
                        filteredHistoryItems.map((tItem) => {
                          const preview =
                            tItem.type === 'string'
                              ? tItem.target
                              : tItem.items.find((sub) => sub.target.trim())?.target || '';
                          const isAi = tItem.translationSource === 'ai';

                          return (
                            <div
                              key={tItem.id}
                              className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-white dark:bg-[#171C27] border border-slate-200/70 dark:border-[#2B3346] text-xs"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectString?.(tItem.id);
                                  setRightDrawerOpen(false);
                                }}
                                className="flex flex-col flex-1 min-w-0 overflow-hidden text-left cursor-pointer"
                              >
                                <div className="flex items-center gap-1.5 w-full">
                                  <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                                    {tItem.name}
                                  </span>
                                  <span
                                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-semibold shrink-0 ${
                                      isAi
                                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                                        : 'bg-[#1EB996]/15 text-emerald-700 dark:text-[#1EB996]'
                                    }`}
                                  >
                                    {isAi ? 'AI' : isAr ? 'يدوي' : 'Manual'}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate w-full">
                                  {preview}
                                </span>
                              </button>

                              {onResetItemHistory && (
                                <button
                                  type="button"
                                  onClick={() => onResetItemHistory(tItem.id)}
                                  title={
                                    isAr
                                      ? `إعادة تعيين ترجمة "${tItem.name}"`
                                      : `Reset translation history for "${tItem.name}"`
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-rose-500/15 dark:bg-[#222938] dark:hover:bg-rose-500/20 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-300 text-[10px] font-medium transition cursor-pointer shrink-0"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>{isAr ? 'إعادة تعيين' : 'Reset'}</span>
                                </button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* QA Checks Summary Section (Placeholders & HTML Tags Validation) */}
              <div
                id="drawer-qa-checks-section"
                className="flex flex-col shrink-0 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] bg-slate-100/80 dark:bg-[#202634] p-3.5 gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {qaSummary.totalAffectedItemsCount > 0 ? (
                      <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 text-[#1EB996] shrink-0" />
                    )}
                    <span className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {isAr ? 'فحوصات الجودة (QA Checks)' : 'QA Checks'}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 tabular-nums ${
                      qaSummary.totalAffectedItemsCount > 0
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                        : 'bg-[#1EB996]/15 text-emerald-700 dark:text-[#1EB996]'
                    }`}
                  >
                    {qaSummary.totalAffectedItemsCount > 0
                      ? isAr
                        ? `${qaSummary.totalAffectedItemsCount} مشاكل`
                        : `${qaSummary.totalAffectedItemsCount} issue${qaSummary.totalAffectedItemsCount > 1 ? 's' : ''}`
                      : isAr
                        ? 'سليم 100%'
                        : 'All Clear'}
                  </span>
                </div>

                {/* Placeholders vs. HTML Tags Cards */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (qaDrawerExpanded && qaDrawerFilter === 'placeholder') {
                        setQaDrawerExpanded(false);
                        setQaDrawerFilter('all');
                      } else {
                        setQaDrawerFilter('placeholder');
                        setQaDrawerExpanded(true);
                      }
                    }}
                    className={`flex flex-col gap-1 p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      qaDrawerFilter === 'placeholder' && qaDrawerExpanded
                        ? 'bg-rose-500/15 border-rose-500/50 ring-1 ring-rose-500/30'
                        : 'bg-white dark:bg-[#171C27] border-slate-200/80 dark:border-[#2B3346] hover:border-rose-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                        <Braces className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span className="truncate">
                          {isAr ? 'المتغيرات (%s, %d)' : 'Placeholders (%s)'}
                        </span>
                      </span>
                    </div>
                    <span
                      className={`text-base font-bold tabular-nums ${
                        qaSummary.placeholderIssueItemsCount > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {qaSummary.placeholderIssueItemsCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (qaDrawerExpanded && qaDrawerFilter === 'html') {
                        setQaDrawerExpanded(false);
                        setQaDrawerFilter('all');
                      } else {
                        setQaDrawerFilter('html');
                        setQaDrawerExpanded(true);
                      }
                    }}
                    className={`flex flex-col gap-1 p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      qaDrawerFilter === 'html' && qaDrawerExpanded
                        ? 'bg-amber-500/15 border-amber-500/50 ring-1 ring-amber-500/30'
                        : 'bg-white dark:bg-[#171C27] border-slate-200/80 dark:border-[#2B3346] hover:border-amber-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                        <Code2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="truncate">
                          {isAr ? 'وسوم HTML' : 'HTML Tags'}
                        </span>
                      </span>
                    </div>
                    <span
                      className={`text-base font-bold tabular-nums ${
                        qaSummary.htmlIssueItemsCount > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {qaSummary.htmlIssueItemsCount}
                    </span>
                  </button>
                </div>

                {/* Expandable QA Issues List */}
                <div className="pt-1 border-t border-slate-200/70 dark:border-[#2B3346]">
                  <button
                    id="drawer-toggle-qa-list-btn"
                    type="button"
                    onClick={() => {
                      setQaDrawerExpanded((prev) => {
                        const next = !prev;
                        if (!next) setQaDrawerFilter('all');
                        return next;
                      });
                    }}
                    className="w-full flex items-center justify-between gap-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-[#1EB996] dark:hover:text-[#1EB996] transition cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <ShieldAlert className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">
                        {isAr
                          ? `تفاصيل فحوصات الجودة (${filteredQaIssues.length})`
                          : `Detected QA Issues (${filteredQaIssues.length})`}
                      </span>
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
                        qaDrawerExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {qaDrawerExpanded && (
                    <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                      {filteredQaIssues.length === 0 ? (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 text-center py-3">
                          {isAr
                            ? 'لا توجد أخطاء في المتغيرات أو وسوم HTML'
                            : 'No placeholder or HTML tag issues detected'}
                        </p>
                      ) : (
                        filteredQaIssues.map((iss) => (
                          <button
                            key={iss.id}
                            type="button"
                            onClick={() => {
                              onSelectString?.(iss.itemId);
                              setRightDrawerOpen(false);
                            }}
                            className="w-full flex flex-col gap-1 px-2.5 py-2 rounded-xl bg-white dark:bg-[#171C27] border border-rose-200/80 dark:border-rose-900/40 hover:border-rose-400 text-left transition cursor-pointer"
                          >
                            <div className="flex items-center justify-between gap-2 w-full">
                              <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                                {iss.itemName}
                              </span>
                              <span
                                className={`inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold shrink-0 ${
                                  iss.category === 'placeholder'
                                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                                }`}
                              >
                                {iss.category === 'placeholder' ? '%s / %d' : 'HTML'}
                              </span>
                            </div>
                            <span className="text-[11px] text-rose-600 dark:text-rose-400 leading-snug">
                              {isAr ? iss.messageAr : iss.messageEn}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Confirm Delete Provider Dialog */}
      {providerToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setProviderToDelete(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white dark:bg-[#1B212E] border border-slate-200 dark:border-[#2F384B] p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0">
                  <Trash2 className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {isAr ? 'حذف مزود الترجمة؟' : 'Delete Translation Provider?'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {providerToDelete.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProviderToDelete(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {isAr
                ? `هل أنت متأكد أنك تريد حذف "${providerToDelete.name}" ومفتاح API المرتبط به من قائمة مزودي الترجمة؟`
                : `Are you sure you want to remove "${providerToDelete.name}" and its API key from your translation providers list?`}
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setProviderToDelete(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2E384B] text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                id="confirm-delete-provider-btn"
                type="button"
                onClick={handleConfirmDeleteProvider}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition cursor-pointer shadow-xs"
              >
                {isAr ? 'تأكيد الحذف' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
