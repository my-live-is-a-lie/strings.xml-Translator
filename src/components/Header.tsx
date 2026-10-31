import { debugIgnored } from '../utils/debug';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Archive, Upload, Download, Sparkles, Languages, Layers, LayoutList, Globe, FileDiff, Keyboard, ChevronDown, X, Palette, Contrast, Paintbrush, FolderOpen, TextCursorInput, SpellCheck } from 'lucide-react';
import { TranslationProject } from '../types';

import { getArabicLanguageName } from '../utils/languages';
import { getStoredItem, setStoredItem } from '../utils/storage';
import { applyAppTheme, getInitialAppTheme, AppTheme } from '../utils/theme';
import { ProvidersPanel, getProviderDisplayName } from './ProvidersPanel';
import { TranslationStatsSection } from './TranslationStatsSection';
import { QaSection } from './QaSection';
import { APP_LANGUAGES, THEME_OPTIONS } from './headerOptions';

import { PWAInstallButton } from './PWAInstallButton';
import { OfflineBadge } from './OfflineBadge';
import { OfflineDot } from './OfflineDot';
import { QuickFilterButton } from './QuickFilters';
import { Menu as MenuIcon } from 'lucide-react';
import { SidebarIcon } from './SidebarIcon';
import { inlineSign } from '../utils/direction';
import { getAllTranslationProviders, getActiveProviderId } from '../utils/translator';

const ACCENT_COLORS = [
  { id: 'teal', label: 'Teal', labelAr: 'زمردي', swatchClass: 'bg-emerald-500' },
  { id: 'blue', label: 'Blue', labelAr: 'أزرق', swatchClass: 'bg-blue-500' },
  { id: 'violet', label: 'Violet', labelAr: 'بنفسجي', swatchClass: 'bg-violet-500' },
  { id: 'rose', label: 'Rose', labelAr: 'وردي', swatchClass: 'bg-rose-500' },
  { id: 'amber', label: 'Amber', labelAr: 'كهرماني', swatchClass: 'bg-amber-500' },
  { id: 'cyan', label: 'Cyan', labelAr: 'سماوي', swatchClass: 'bg-cyan-500' },
] as const;

type AccentColorId = (typeof ACCENT_COLORS)[number]['id'];

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
  appTheme?: AppTheme;
  onAppThemeChange?: (theme: AppTheme) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  undoCount?: number;
  redoCount?: number;
  autoTranslate?: boolean;
  onToggleAutoTranslate?: (enabled: boolean) => void;
  predictiveWords?: boolean;
  onTogglePredictiveWords?: (enabled: boolean) => void;
  autoCorrect?: boolean;
  onToggleAutoCorrect?: (enabled: boolean) => void;
  /** Narrow container (landscape split half): the top bar wraps instead of overflowing. */
  compact?: boolean;
  /** Landscape split: 'bar' = top app bar + drawer only, 'stats' = progress and counts only, 'all' = both. */
  part?: 'all' | 'bar' | 'stats' | 'legend' | 'track' | 'dock';
  /** Dock only: opens the strings list and how many strings it holds. */
  onOpenStringsList?: () => void;
  stringsCount?: number;
  onResetItemHistory?: (id: string) => void;
  onSelectString?: (id: string) => void;
  onOpenFilesModal?: () => void;
  onOpenShortcuts?: () => void;
  onOpenUpdateSource?: () => void;
  onOpenMultiLang?: () => void;
  savedFilesCount?: number;
  currentFileName?: string;
}

// Wrapped with React.memo below: re-renders only when its props change
const HeaderBase: React.FC<HeaderProps> = ({
  project,
  activeView,
  onViewChange,
  onOpenImport,
  onOpenExport,
  onLoadSample,
  onOpenLanguageModal,
  appLang = 'ar',
  onAppLangChange,
  appTheme: propAppTheme,
  onAppThemeChange,
  autoTranslate = false,
  onToggleAutoTranslate,
  predictiveWords = false,
  onTogglePredictiveWords,
  autoCorrect = true,
  onToggleAutoCorrect,
  compact = false,
  part = 'all',
  onOpenStringsList,
  stringsCount = 0,
  onResetItemHistory,
  onSelectString,
  onOpenFilesModal,
  onOpenShortcuts,
  onOpenUpdateSource,
  onOpenMultiLang,
  savedFilesCount = 0,
  currentFileName,
}) => {
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  // Which physical edge the drawer slides from when it was opened by an edge swipe (null = the default side)
  const [edgeSide, setEdgeSide] = useState<'left' | 'right' | null>(null);
  const drawerSide: 'left' | 'right' = edgeSide ?? (inlineSign() === 1 ? 'right' : 'left');
  const drawerOwner = part === 'all' || part === 'bar' || part === 'dock';

  // Swipe in from either screen edge to open the drawer from that side
  useEffect(() => {
    if (!drawerOwner || rightDrawerOpen) return;
    const EDGE = 28;
    let start: { x: number; y: number; side: 'left' | 'right' } | null = null;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const w = window.innerWidth;
      if (t.clientX <= EDGE) start = { x: t.clientX, y: t.clientY, side: 'left' };
      else if (t.clientX >= w - EDGE) start = { x: t.clientX, y: t.clientY, side: 'right' };
      else start = null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const dx = (e.touches[0].clientX - start.x) * (start.side === 'left' ? 1 : -1);
      const dy = Math.abs(e.touches[0].clientY - start.y);
      if (dx > 50 && dx > dy * 1.5) {
        setEdgeSide(start.side);
        setRightDrawerOpen(true);
        start = null;
      }
    };
    const onEnd = () => {
      start = null;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [drawerOwner, rightDrawerOpen]);
  const [appLangMenuOpen, setAppLangMenuOpen] = useState(false);
  const [drawerSwipeX, setDrawerSwipeX] = useState(0);
  const [isSwipingDrawer, setIsSwipingDrawer] = useState(false);
  const drawerTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isAr = appLang === 'ar';

  const [accentColor, setAccentColor] = useState<AccentColorId>(() => {
    const saved = getStoredItem('app_accent_color') as AccentColorId | null;
    if (saved && ACCENT_COLORS.some((c) => c.id === saved)) {
      return saved;
    }
    return 'teal';
  });

  // The panel owns the provider forms; the header only needs to know which provider is active
  const [providersRevision, setProvidersRevision] = useState(0);
  const activeProviderObj = useMemo(() => {
    void providersRevision;
    const list = getAllTranslationProviders();
    return list.find((p) => p.id === getActiveProviderId()) || list[0];
  }, [providersRevision]);

  const [themeSubmenuOpen, setThemeSubmenuOpen] = useState(false);
  const [paletteSubmenuOpen, setPaletteSubmenuOpen] = useState(false);

  const [localAppTheme, setLocalAppTheme] = useState<AppTheme>(() => getInitialAppTheme());

  const appTheme = propAppTheme ?? localAppTheme;

  const handleSelectTheme = (newTheme: AppTheme) => {
    applyAppTheme(newTheme);
    setLocalAppTheme(newTheme);
    if (onAppThemeChange) {
      onAppThemeChange(newTheme);
    }
  };

  useEffect(() => {
    applyAppTheme(appTheme);
  }, [appTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accentColor);
    setStoredItem('app_accent_color', accentColor);
  }, [accentColor]);

  const handleRandomAccentColor = () => {
    const remaining = ACCENT_COLORS.filter((c) => c.id !== accentColor);
    const randomPick = remaining[Math.floor(Math.random() * remaining.length)] || ACCENT_COLORS[0];
    setAccentColor(randomPick.id);
    if (window.navigator?.vibrate) {
      try {
        window.navigator.vibrate(12);
      } catch (err) {
        debugIgnored('haptics', err);
      }
    }
  };

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

  const showBar = part === 'all' || part === 'bar';
  const showTrack = part === 'all' || part === 'stats' || part === 'track';
  const showLegend = part === 'all' || part === 'stats' || part === 'legend';
  const showStatsBlock = showTrack || showLegend;

  return (
    <>
      <header className={`${part !== 'all' ? '' : 'sticky top-0 z-30'} bg-white/95 dark:bg-[#131314]/95 backdrop-blur-md md:border-b border-slate-200/80 dark:border-slate-800/80 transition-colors`}>
        {part === 'dock' && (
          <div className="px-2 py-1.5 flex items-center justify-between gap-1.5 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={onOpenFilesModal}
              className="flex items-center gap-2 h-9 px-2.5 rounded-xl bg-slate-100 dark:bg-[#1E2430] text-slate-800 dark:text-slate-100 shrink-0 min-w-0 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-[#0B57D0] dark:text-[#1EB996] shrink-0" />
              <span className="font-semibold">{isAr ? 'الملفات' : 'Files'}</span>
              {currentFileName && (
                <span className="max-w-[90px] truncate font-mono text-slate-600 dark:text-slate-400" dir="ltr">({currentFileName})</span>
              )}
              {savedFilesCount > 0 && <span className="font-bold tabular-nums">{savedFilesCount}</span>}
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>
            <QuickFilterButton appLang={appLang} className="h-9 shrink-0 text-xs" />
            <button
              type="button"
              onClick={onOpenStringsList}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent font-medium text-slate-800 dark:text-slate-200 shrink-0 cursor-pointer"
            >
              <MenuIcon className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
              <span>{isAr ? `قائمة النصوص (${stringsCount})` : `Strings List (${stringsCount})`}</span>
            </button>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
            <OfflineDot appLang={appLang} />
            <button
              type="button"
              onClick={() => onViewChange('table')}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-slate-800 dark:text-slate-200 font-medium shrink-0 cursor-pointer"
            >
              <LayoutList className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
              <span>{isAr ? 'الجدول' : 'Table'}</span>
            </button>
            <button
              id="header-right-drawer-btn"
              type="button"
              onClick={() => {
                setAppLangMenuOpen(false);
                setEdgeSide(null);
                setRightDrawerOpen(true);
              }}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 shrink-0 cursor-pointer"
              title={isAr ? 'فتح القائمة الجانبية' : 'Open Sidebar Menu'}
              aria-label="Open Actions Menu"
            >
              <SidebarIcon className="w-4.5 h-4.5 text-slate-700 dark:text-slate-200" />
            </button>
            </div>
          </div>
        )}

        {showBar && (
          <>
        {/* Material 3 Top App Bar */}
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 ${compact ? 'min-h-13 py-1.5 flex-wrap gap-y-1.5' : 'h-13 sm:h-14'} flex items-center justify-between gap-4`}>
          {/* Files Button (replacing App Icon & Name at top left corner) */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              id="header-files-menu-btn"
              type="button"
              onClick={onOpenFilesModal}
              className="flex items-center gap-2 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-[#1E2430] dark:hover:bg-[#283244] text-slate-800 dark:text-slate-100 transition cursor-pointer shadow-xs group"
              title={isAr ? 'عرض وإدارة ملفات XML المستوردة' : 'View & manage imported XML files'}
            >
              <div className="w-6 h-6 rounded-lg bg-[#0B57D0]/10 dark:bg-[#1EB996]/15 flex items-center justify-center text-[#0B57D0] dark:text-[#1EB996] group-hover:scale-105 transition-transform shrink-0">
                <FolderOpen className="w-3.5 h-3.5" />
              </div>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">
                  {isAr ? 'الملفات' : 'Files'}
                </span>
                {currentFileName && (
                  <span className="hidden sm:inline-block max-w-[110px] md:max-w-[150px] truncate text-xs text-slate-600 dark:text-slate-400 font-mono">
                    ({currentFileName})
                  </span>
                )}
              </div>
              {savedFilesCount > 0 && (
                <span className="text-[11px] font-bold text-white tabular-nums px-0.5">
                  {savedFilesCount}
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-200 transition-transform shrink-0" />
            </button>
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
                <span className="font-semibold">
                  {isAr
                    ? getArabicLanguageName(project.targetLang, project.targetLocaleName)
                    : project.targetLocaleName || project.targetLang}
                </span>
                <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400 bg-black/10 dark:bg-black/30 px-1.5 py-0.5 rounded">
                  values-{project.targetLang}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-200" />
              </button>
            </div>
          </div>

          {/* Right Actions - Far Right List Icon Button */}
          <div className="flex items-center gap-2 shrink-0">
            <OfflineBadge appLang={appLang} />

            <PWAInstallButton appLang={appLang} />

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

            {/* Far Right Sidebar Icon Button to Open Right Drawer */}
            <button
              id="header-right-drawer-btn"
              type="button"
              onClick={() => {
                setAppLangMenuOpen(false);
                setEdgeSide(null);
                setRightDrawerOpen(true);
              }}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 transition cursor-pointer m3-state-layer"
              title={isAr ? 'فتح القائمة الجانبية' : 'Open Sidebar Menu'}
              aria-label="Open Actions Menu"
            >
              <SidebarIcon className="w-4.5 h-4.5 text-slate-700 dark:text-slate-200" />
            </button>
          </div>
        </div>

          </>
        )}

        {showStatsBlock && (
          <>
        {/* Visual Progress Bar & Translated vs. Untranslated Breakdown */}
        <div className="bg-white/95 dark:bg-[#131314]/95 border-t border-slate-200/60 dark:border-slate-800/70">
          {/* Segmented Progress Track - thin (h-1), edge-to-edge, touching spacer line above */}
          {showTrack && (
          <div
            role="progressbar"
            aria-valuenow={translatedPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Translation progress: ${translatedPercent}% translated, ${untranslatedPercent}% untranslated`}
            className="w-full h-1 bg-slate-200/90 dark:bg-slate-800 overflow-hidden block"
          >
            <svg
              viewBox="0 0 100 4"
              preserveAspectRatio="none"
              className="w-full h-full block"
            >
              {/* Untranslated background track */}
              <rect
                x={0}
                y={0}
                width={100}
                height={4}
                className="fill-slate-200 dark:fill-slate-800"
              />
              {/* Translated segment */}
              <rect
                x={0}
                y={0}
                width={exactTranslatedWidth}
                height={4}
                className="fill-[#1EB996] transition-all duration-300 ease-out"
              />
              {/* Needs Review segment */}
              {exactReviewWidth > 0 && (
                <rect
                  x={exactTranslatedWidth}
                  y={0}
                  width={exactReviewWidth}
                  height={4}
                  className="fill-amber-400 transition-all duration-300 ease-out"
                />
              )}
            </svg>
          </div>
          )}

          {showLegend && (
          <div className={part === 'legend' ? 'px-3 py-1.5' : 'max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-0.5 md:py-2'}>
            {/* Breakdown Legend & Mobile View Switcher */}
            <div className={`flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400 ${part === 'legend' ? 'text-[10px] flex-nowrap' : 'text-[11px] sm:text-xs flex-wrap'}`}>
              <div className={`flex items-center ${part === 'legend' ? 'gap-2 flex-nowrap whitespace-nowrap' : 'gap-3 flex-wrap'}`}>
                {/* Translated stat */}
                <div className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#1EB996] shrink-0" />
                  <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {translatedPercent}% {isAr ? 'مترجم' : 'Translated'}
                  </span>
                  <span className="text-slate-600 dark:text-slate-400 tabular-nums">
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
                  <span className="text-slate-600 dark:text-slate-400 tabular-nums">
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
          )}
        </div>
          </>
        )}
      </header>

      {/* Right-Side Slide-Out Drawer for Import & Export */}
      {(showBar || part === 'dock') && rightDrawerOpen && (
        <div className="fixed inset-0 z-50 flex" style={{ direction: 'ltr', justifyContent: drawerSide === 'left' ? 'flex-start' : 'flex-end' }}>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => {
              setAppLangMenuOpen(false);
              setRightDrawerOpen(false);
            }}
          />

          {/* Drawer Content on the Right Side */}
          <aside
            onTouchStart={(e) => {
              if (e.touches.length === 1) {
                drawerTouchStartRef.current = {
                  x: e.touches[0].clientX,
                  y: e.touches[0].clientY,
                };
                setIsSwipingDrawer(false);
              }
            }}
            onTouchMove={(e) => {
              if (!drawerTouchStartRef.current || e.touches.length !== 1) return;
              const deltaX = e.touches[0].clientX - drawerTouchStartRef.current.x;
              const deltaY = e.touches[0].clientY - drawerTouchStartRef.current.y;
              // Swiping to the right (positive deltaX): if horizontal movement is dominant, track swipe
              // (measured towards the drawer's own edge: right in LTR, left in RTL)
              const edgeDelta = deltaX * (drawerSide === 'right' ? 1 : -1);
              if (edgeDelta > 8 && Math.abs(deltaX) > Math.abs(deltaY) * 0.8) {
                setIsSwipingDrawer(true);
                setDrawerSwipeX(Math.max(0, edgeDelta));
              }
            }}
            onTouchEnd={() => {
              if (isSwipingDrawer && drawerSwipeX > 60) {
                // Sufficient swipe to the right -> close drawer
                setAppLangMenuOpen(false);
                setRightDrawerOpen(false);
              }
              setDrawerSwipeX(0);
              setIsSwipingDrawer(false);
              drawerTouchStartRef.current = null;
            }}
            onTouchCancel={() => {
              setDrawerSwipeX(0);
              setIsSwipingDrawer(false);
              drawerTouchStartRef.current = null;
            }}
            style={{
              transform: drawerSwipeX > 0 ? `translateX(${drawerSwipeX * (drawerSide === 'right' ? 1 : -1)}px)` : undefined,
              transition: isSwipingDrawer ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              direction: inlineSign() === 1 ? 'ltr' : 'rtl',
            }}
            className={`relative w-72 sm:w-80 max-w-[85vw] h-dvh max-h-dvh overflow-hidden bg-white dark:bg-[#161922] ${drawerSide === 'right' ? 'border-l' : 'border-r'} border-slate-200 dark:border-[#252C3A] shadow-2xl z-10 flex flex-col animate-in ${drawerSide === 'right' ? 'slide-in-from-right' : 'slide-in-from-left'} duration-200`}
          >
            {/* Drawer Header: 4 Squircle Buttons (Language, Theme, Random Accent, Palette) + Close Button */}
            <div className="relative flex items-center justify-between gap-2 px-3.5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-slate-200/80 dark:border-[#252C3A]">
              <div className="flex items-center gap-2 min-w-0">
                {/* 1. App Language Button */}
                <button
                  id="drawer-language-btn"
                  type="button"
                  onClick={() => {
                    setAppLangMenuOpen((prev) => !prev);
                    setThemeSubmenuOpen(false);
                    setPaletteSubmenuOpen(false);
                  }}
                  className={`w-9.5 h-9.5 rounded-2xl flex items-center justify-center transition cursor-pointer shrink-0 border ${
                    appLangMenuOpen
                      ? 'bg-slate-200 dark:bg-[#252F42] border-[var(--accent-primary)]/70 shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200/80 dark:bg-[#1C2333] dark:hover:bg-[#242E40] border-slate-200/80 dark:border-[#2A3446]'
                  }`}
                  title={isAr ? 'تغيير لغة التطبيق' : 'Change App Language'}
                  aria-label="Change app language"
                >
                  <Languages style={{ color: 'var(--accent-primary)' }} className="w-5 h-5" />
                </button>

                {/* 2. Theme Mode Button (Day, Night, Black Hole) */}
                <button
                  id="drawer-theme-btn"
                  type="button"
                  onClick={() => {
                    setThemeSubmenuOpen((prev) => !prev);
                    setAppLangMenuOpen(false);
                    setPaletteSubmenuOpen(false);
                  }}
                  className={`w-9.5 h-9.5 rounded-2xl flex items-center justify-center transition cursor-pointer shrink-0 border ${
                    themeSubmenuOpen
                      ? 'bg-slate-200 dark:bg-[#252F42] border-[var(--accent-primary)]/70 shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200/80 dark:bg-[#1C2333] dark:hover:bg-[#242E40] border-slate-200/80 dark:border-[#2A3446]'
                  }`}
                  title={isAr ? 'تغيير مظهر التطبيق (نهار / ليل / ثقب أسود)' : 'Change app theme (Day / Night / Black Hole)'}
                  aria-label="Change app theme"
                >
                  <Contrast style={{ color: 'var(--accent-primary)' }} className="w-5 h-5" />
                </button>

                {/* 3. Random Accent Color Picker */}
                <button
                  id="drawer-random-accent-btn"
                  type="button"
                  onClick={handleRandomAccentColor}
                  className="w-9.5 h-9.5 rounded-2xl flex items-center justify-center transition cursor-pointer shrink-0 border bg-slate-100 hover:bg-slate-200/80 dark:bg-[#1C2333] dark:hover:bg-[#242E40] border-slate-200/80 dark:border-[#2A3446] active:scale-95"
                  title={isAr ? 'اختيار لون عشوائي للتمييز' : 'Pick random accent color'}
                  aria-label="Pick random accent color"
                >
                  <Paintbrush style={{ color: 'var(--accent-primary)' }} className="w-5 h-5" />
                </button>

                {/* 4. Accent Color Palette Picker */}
                <button
                  id="drawer-accent-palette-btn"
                  type="button"
                  onClick={() => {
                    setPaletteSubmenuOpen((prev) => !prev);
                    setThemeSubmenuOpen(false);
                    setAppLangMenuOpen(false);
                  }}
                  className={`w-9.5 h-9.5 rounded-2xl flex items-center justify-center transition cursor-pointer shrink-0 border ${
                    paletteSubmenuOpen
                      ? 'bg-slate-200 dark:bg-[#252F42] border-[var(--accent-primary)]/70 shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200/80 dark:bg-[#1C2333] dark:hover:bg-[#242E40] border-slate-200/80 dark:border-[#2A3446]'
                  }`}
                  title={isAr ? 'لوحة ألوان التمييز' : 'Accent color palette'}
                  aria-label="Choose accent color"
                >
                  <Palette style={{ color: 'var(--accent-primary)' }} className="w-5 h-5" />
                </button>
              </div>

              {/* Close Drawer Button */}
              <button
                type="button"
                onClick={() => {
                  setAppLangMenuOpen(false);
                  setThemeSubmenuOpen(false);
                  setPaletteSubmenuOpen(false);
                  setRightDrawerOpen(false);
                }}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1E2533] transition cursor-pointer shrink-0"
                aria-label="Close drawer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Sub-menu Row: Language Options */}
            {appLangMenuOpen && (
              <div className="px-4 py-2.5 flex items-center gap-6 border-b border-slate-200/80 dark:border-[#252C3A] bg-slate-50/70 dark:bg-[#141822]/60 animate-in fade-in duration-150">
                {APP_LANGUAGES.map((lang) => {
                  const isSelected = appLang === lang.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => {
                        onAppLangChange?.(lang.code);
                      }}
                      className={`relative pb-1 text-sm font-medium transition cursor-pointer ${
                        isSelected
                          ? 'text-slate-900 dark:text-white font-semibold'
                          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>{lang.label}</span>
                      {isSelected && (
                        <span className="absolute bottom-0 inset-x-0 h-0.5 bg-slate-900 dark:bg-white rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Sub-menu Row: Theme Options (نهار / ليل / ثقب أسود) matching mockup */}
            {themeSubmenuOpen && (
              <div className="px-4 py-2.5 flex items-center gap-6 border-b border-slate-200/80 dark:border-[#252C3A] bg-slate-50/70 dark:bg-[#141822]/60 animate-in fade-in duration-150">
                {THEME_OPTIONS.map((theme) => {
                  const isSelected = appTheme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => handleSelectTheme(theme.id)}
                      className={`relative pb-1 text-sm font-medium transition cursor-pointer ${
                        isSelected
                          ? 'text-slate-900 dark:text-white font-semibold'
                          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>{isAr ? theme.labelAr : theme.label}</span>
                      {isSelected && (
                        <span className="absolute bottom-0 inset-x-0 h-0.5 bg-slate-900 dark:bg-white rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Sub-menu Row: Accent Color Palette Swatches matching mockup */}
            {paletteSubmenuOpen && (
              <div className="px-4 py-2.5 flex items-center justify-between sm:justify-start sm:gap-4 border-b border-slate-200/80 dark:border-[#252C3A] bg-slate-50/70 dark:bg-[#141822]/60 animate-in fade-in duration-150">
                {ACCENT_COLORS.map((c) => {
                  const isSelected = accentColor === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setAccentColor(c.id)}
                      className={`w-6.5 h-6.5 rounded-full ${c.swatchClass} transition cursor-pointer flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'scale-115 ring-2.5 ring-slate-900 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-[#161922]'
                          : 'opacity-85 hover:opacity-100 hover:scale-105'
                      }`}
                      title={isAr ? `لون ${c.labelAr}` : `${c.label} accent`}
                      aria-label={isAr ? `اختيار اللون ${c.labelAr}` : `Set ${c.label} accent color`}
                    />
                  );
                })}
              </div>
            )}

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

              {onOpenMultiLang && (
                <button
                  id="drawer-multilang-btn"
                  type="button"
                  onClick={() => {
                    setAppLangMenuOpen(false);
                    setRightDrawerOpen(false);
                    onOpenMultiLang();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#202634] text-xs font-medium transition cursor-pointer shrink-0"
                >
                  <Archive className="w-4 h-4" aria-hidden="true" />
                  <span>{isAr ? 'ترجمة عدة لغات (ZIP)' : 'Multi-language ZIP'}</span>
                </button>
              )}

              {onOpenUpdateSource && (
                <button
                  id="drawer-update-source-btn"
                  type="button"
                  onClick={() => {
                    setAppLangMenuOpen(false);
                    setRightDrawerOpen(false);
                    onOpenUpdateSource();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#202634] text-xs font-medium transition cursor-pointer shrink-0"
                >
                  <FileDiff className="w-4 h-4" aria-hidden="true" />
                  <span>{isAr ? 'تحديث ملف المصدر' : 'Update source file'}</span>
                </button>
              )}

              <ProvidersPanel isAr={isAr} onChanged={() => setProvidersRevision((r) => r + 1)} />

              {/* Auto-Translate Option Toggle (Under Translate Providers) */}
              <button
                type="button"
                onClick={() => onToggleAutoTranslate?.(!autoTranslate)}
                role="switch"
                aria-checked={autoTranslate}
                id="drawer-auto-translate-toggle"
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition cursor-pointer shrink-0 select-none text-start ${
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
                    <span className="w-full text-[11px] text-slate-600 dark:text-slate-400 leading-snug truncate">
                      {isAr
                        ? `ترجمة تلقائية عبر ${getProviderDisplayName(activeProviderObj, isAr)}`
                        : `Auto-translate via ${activeProviderObj?.name || 'Google Translate'}`}
                    </span>
                  </div>
                </div>

                {/* Toggle Pill Switch */}
                <div
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
                    autoTranslate
                      ? 'bg-[#1EB996]'
                      : 'bg-slate-300 dark:bg-[#343E52]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      autoTranslate ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>

              {/* Predictive words: grey completions taken from the machine translation of the source */}
              <button
                type="button"
                onClick={() => onTogglePredictiveWords?.(!predictiveWords)}
                role="switch"
                aria-checked={predictiveWords}
                id="drawer-predictive-words-toggle"
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition cursor-pointer shrink-0 select-none text-start ${
                  predictiveWords
                    ? 'bg-[#1EB996]/12 border-[#1EB996]/50 text-slate-900 dark:text-white'
                    : 'bg-slate-100/90 hover:bg-slate-200/70 dark:bg-[#202634] dark:hover:bg-[#2A3244] border-slate-200/90 dark:border-[#2F384B] text-slate-800 dark:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden">
                  <TextCursorInput
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      predictiveWords ? 'text-[#1EB996]' : 'text-slate-400 dark:text-slate-400'
                    }`}
                  />
                  <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                    <span className="w-full text-xs sm:text-sm font-semibold leading-snug truncate">
                      {isAr ? 'تنبؤ بالكلمات التالية' : 'Predict next words'}
                    </span>
                    <span className="w-full text-[11px] text-slate-600 dark:text-slate-400 leading-snug truncate">
                      {isAr ? 'إكمال الكلمة بالمسافة، والرجوع لرفضها' : 'Space accepts, Backspace rejects'}
                    </span>
                  </div>
                </div>
                <div
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
                    predictiveWords ? 'bg-[#1EB996]' : 'bg-slate-300 dark:bg-[#343E52]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      predictiveWords ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>

              {/* Auto-correct: fixes punctuation, placeholders, tags and brackets before saving */}
              <button
                type="button"
                onClick={() => onToggleAutoCorrect?.(!autoCorrect)}
                role="switch"
                aria-checked={autoCorrect}
                id="drawer-auto-correct-toggle"
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition cursor-pointer shrink-0 select-none text-start ${
                  autoCorrect
                    ? 'bg-[#1EB996]/12 border-[#1EB996]/50 text-slate-900 dark:text-white'
                    : 'bg-slate-100/90 hover:bg-slate-200/70 dark:bg-[#202634] dark:hover:bg-[#2A3244] border-slate-200/90 dark:border-[#2F384B] text-slate-800 dark:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden">
                  <SpellCheck
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      autoCorrect ? 'text-[#1EB996]' : 'text-slate-400 dark:text-slate-400'
                    }`}
                  />
                  <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                    <span className="w-full text-xs sm:text-sm font-semibold leading-snug truncate">
                      {isAr ? 'التصحيح التلقائي' : 'Auto-correct'}
                    </span>
                    <span className="w-full text-[11px] text-slate-600 dark:text-slate-400 leading-snug truncate">
                      {isAr ? 'عطّله للكتابة بحرية دون تنبيهات' : 'Turn off to type freely, without warnings'}
                    </span>
                  </div>
                </div>
                <div
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
                    autoCorrect ? 'bg-[#1EB996]' : 'bg-slate-300 dark:bg-[#343E52]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      autoCorrect ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>

              <TranslationStatsSection project={project} isAr={isAr} onSelectString={onSelectString} onResetItemHistory={onResetItemHistory} onClose={() => setRightDrawerOpen(false)} />
              <QaSection project={project} isAr={isAr} onSelectString={onSelectString} onClose={() => setRightDrawerOpen(false)} />

              {onOpenShortcuts && (
                <button
                  id="drawer-shortcuts-btn"
                  type="button"
                  onClick={() => {
                    setRightDrawerOpen(false);
                    onOpenShortcuts();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#202634] text-xs font-medium transition cursor-pointer shrink-0"
                >
                  <Keyboard className="w-4 h-4" aria-hidden="true" />
                  <span>{isAr ? 'اختصارات لوحة المفاتيح (?)' : 'Keyboard shortcuts (?)'}</span>
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

    </>
  );
};

export const Header = React.memo(HeaderBase);
