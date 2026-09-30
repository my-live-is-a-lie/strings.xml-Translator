import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { StringList } from './components/StringList';
import { TranslationEditor } from './components/TranslationEditor';
import { TableView } from './components/TableView';
import { ImportModal } from './components/ImportModal';
import { ExportModal } from './components/ExportModal';
import { TranslationProject, ResourceItem, FilterStatus, SourceFilter } from './types';
import { parseAndroidXml, mergeTargetXml, normalizePluralsForLanguage } from './utils/xmlParser';
import { SAMPLE_ANDROID_STRINGS_XML, SAMPLE_TARGET_ARABIC_XML, SAMPLE_TARGET_SPANISH_XML } from './utils/sampleData';
import { saveCurrentProject, loadCurrentProject, getStoredItem, setStoredItem } from './utils/storage';
import { LanguageSelectorModal } from './components/LanguageSelectorModal';
import { getLanguageOption } from './utils/languages';
import {
  getAutoTranslateEnabled,
  setAutoTranslateEnabled,
} from './utils/translator';
import { Menu, X } from 'lucide-react';

interface HistorySnapshot {
  items: ResourceItem[];
  targetLang: string;
  targetLocaleName?: string;
  translationsByLang?: Record<string, ResourceItem[]>;
  selectedId: string;
}

interface EditorState {
  project: TranslationProject;
  selectedId: string;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
}

const MAX_HISTORY_STEPS = 100;
const TYPING_COALESCE_MS = 700;

const LOCALE_NAMES: Record<string, string> = {
  ar: 'العربية',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  'pt-rBR': 'Portuguese BR',
  ja: 'Japanese',
  'zh-rCN': 'Chinese Simplified',
  it: 'Italian',
  ru: 'Russian',
  hi: 'Hindi',
  tr: 'Turkish',
  pl: 'Polish',
};

function repairSavedProjectItems(items: ResourceItem[], targetLang: string): ResourceItem[] {
  const normalized = normalizePluralsForLanguage(items, targetLang);
  const multilineRealNewlineKeys = new Set([
    'import_youtube_instructions',
    'remove_watched_popup_warning',
    'feed_use_dedicated_fetch_method_help_text_new',
    'no_appropriate_file_manager_message',
    'no_appropriate_file_manager_message_android_10',
  ]);

  return normalized.map((item) => {
    const defaultSource =
      item.status !== 'untranslated' ? item.translationSource || ('manual' as const) : undefined;
    if (item.type !== 'string') {
      return {
        ...item,
        translationSource: defaultSource,
      };
    }
    let { source, target } = item;

    // Restore exact original source syntax if project was imported under older parser
    if (item.name === 'info_labels' && !source.includes('\\\\n')) {
      source = source.replace(/(?<!\\)\\n/g, '\\\\n');
    }
    if (item.name === 'app_description_new' && !source.endsWith(' ')) {
      source = source + ' ';
    }
    if (item.name === 'top_bottom_bullet_comments_duration_summary' && !source.endsWith(' ')) {
      source = source + ' ';
    }
    if (item.name === 'need_login_hint' && !source.startsWith(' ')) {
      source = ' ' + source;
    }
    if (
      item.name === 'preferred_player_fetcher_notification_message' &&
      !source.startsWith('"')
    ) {
      source = `"${source.replace(/^\\?"|\\?"$/g, '')}"`;
    }
    if (multilineRealNewlineKeys.has(item.name) && !/\r?\n\\n/.test(source)) {
      source = source
        .replace(/\\n\\n\\n\\n/g, '\n\\n\n\\n')
        .replace(/\\n\\n/g, '\n\\n');
      if (!/\r?\n\\n/.test(source)) {
        source = source.replace(/\\n/g, '\n\\n');
      }
    }

    return {
      ...item,
      source,
      target,
      translationSource: defaultSource,
    };
  });
}

function createDefaultProject(): TranslationProject {
  const { items, resourcesAttributes, indentStyle, itemIndentStyle } = parseAndroidXml(SAMPLE_ANDROID_STRINGS_XML);
  // Pre-merge with Arabic sample (including all 6 Arabic plural forms: zero, one, two, few, many, other)
  const { updatedItems } = mergeTargetXml(items, SAMPLE_TARGET_ARABIC_XML, 'ar');

  return {
    id: 'sample_project_1',
    name: 'XML Translator',
    sourceFileName: 'strings.xml',
    sourceLang: 'en',
    targetLang: 'ar',
    targetLocaleName: 'العربية',
    items: updatedItems,
    rawSourceXml: SAMPLE_ANDROID_STRINGS_XML,
    resourcesAttributes,
    indentStyle,
    itemIndentStyle,
    lastModified: Date.now(),
  };
}

export default function App() {
  const [editorState, setEditorState] = useState<EditorState>(() => {
    let initialProject: TranslationProject;
    try {
      const saved = loadCurrentProject();
      initialProject =
        saved && Array.isArray(saved.items) && saved.items.length > 0
          ? {
              ...saved,
              name: saved.name === 'OmniTask Android' ? 'XML Translator' : saved.name,
              items: repairSavedProjectItems(saved.items, saved.targetLang || 'ar'),
            }
          : createDefaultProject();
    } catch {
      initialProject = createDefaultProject();
    }

    const watchedItem = initialProject.items.find((i) => i.name === 'quick_action_watched');
    const initialSelectedId = watchedItem ? watchedItem.id : (initialProject.items[0]?.id || '');

    return {
      project: initialProject,
      selectedId: initialSelectedId,
      past: [],
      future: [],
    };
  });

  const { project, selectedId, past, future } = editorState;

  // Track last typing edit metadata for smart coalescing of continuous keystrokes
  const lastEditRef = useRef<{ itemId: string; timestamp: number }>({
    itemId: '',
    timestamp: 0,
  });

  const setSelectedId = useCallback((id: string) => {
    lastEditRef.current = { itemId: '', timestamp: 0 };
    setEditorState((prev) => ({
      ...prev,
      selectedId: id,
    }));
  }, []);

  const [activeView, setActiveView] = useState<'editor' | 'table'>('editor');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [appLang, setAppLang] = useState<'ar' | 'en'>(() => {
    const saved = getStoredItem('app_ui_language');
    return saved === 'en' ? 'en' : 'ar';
  });
  const [autoTranslate, setAutoTranslate] = useState<boolean>(() => getAutoTranslateEnabled());

  const handleToggleAutoTranslate = useCallback((enabled: boolean) => {
    setAutoTranslate(enabled);
    setAutoTranslateEnabled(enabled);
  }, []);

  useEffect(() => {
    setStoredItem('app_ui_language', appLang);
  }, [appLang]);

  // Auto-save project locally on change
  useEffect(() => {
    saveCurrentProject(project);
  }, [project]);

  // If selectedId is invalid, default to first item
  useEffect(() => {
    if (!project.items.some((i) => i.id === selectedId) && project.items.length > 0) {
      setSelectedId(project.items[0].id);
    }
  }, [project.items, selectedId, setSelectedId]);

  // Current item and index
  const currentIndex = useMemo(() => {
    return project.items.findIndex((i) => i.id === selectedId);
  }, [project.items, selectedId]);

  const currentItem = project.items[currentIndex] || project.items[0];

  // Update translation of an item with Undo/Redo history tracking
  const handleUpdateTranslation = useCallback(
    (updatedItem: ResourceItem, options?: { undoDeletesText?: boolean }) => {
      const now = Date.now();

      setEditorState((curr) => {
        const oldItem = curr.project.items.find((i) => i.id === updatedItem.id);
        if (!oldItem) {
          return curr;
        }
        if (!options?.undoDeletesText && JSON.stringify(oldItem) === JSON.stringify(updatedItem)) {
          return curr;
        }

        // Check if this is a rapid single-character typing edit on the same string
        let isRapidSingleCharEdit = false;
        if (
          !options?.undoDeletesText &&
          oldItem.type === 'string' &&
          updatedItem.type === 'string' &&
          curr.past.length > 0 &&
          lastEditRef.current.itemId === updatedItem.id &&
          now - lastEditRef.current.timestamp < TYPING_COALESCE_MS
        ) {
          const lenDiff = Math.abs(oldItem.target.length - updatedItem.target.length);
          const notCleared = updatedItem.target.length > 0;
          if (lenDiff <= 1 && notCleared) {
            isRapidSingleCharEdit = true;
          }
        }

        let nextPast = curr.past;
        if (!isRapidSingleCharEdit) {
          const snapshotItems = options?.undoDeletesText
            ? curr.project.items.map((item) => {
                if (item.id !== updatedItem.id) return item;
                if (item.type === 'string') {
                  return {
                    ...item,
                    target: '',
                    status: 'untranslated' as const,
                    translationSource: undefined,
                  };
                }
                if (item.type === 'plural') {
                  return {
                    ...item,
                    items: item.items.map((pi) => ({ ...pi, target: '' })),
                    status: 'untranslated' as const,
                    translationSource: undefined,
                  };
                }
                if (item.type === 'array') {
                  return {
                    ...item,
                    items: item.items.map((ai) => ({ ...ai, target: '' })),
                    status: 'untranslated' as const,
                    translationSource: undefined,
                  };
                }
                return item;
              })
            : curr.project.items;

          const snapshot: HistorySnapshot = {
            items: snapshotItems,
            targetLang: curr.project.targetLang,
            targetLocaleName: curr.project.targetLocaleName,
            translationsByLang: curr.project.translationsByLang,
            selectedId: curr.selectedId,
          };
          nextPast = [...curr.past.slice(-(MAX_HISTORY_STEPS - 1)), snapshot];
        }

        // Record typing metadata only for single-character typing edits
        if (
          !options?.undoDeletesText &&
          oldItem.type === 'string' &&
          updatedItem.type === 'string' &&
          Math.abs(oldItem.target.length - updatedItem.target.length) <= 1 &&
          updatedItem.target.length > 0
        ) {
          lastEditRef.current = { itemId: updatedItem.id, timestamp: now };
        } else {
          lastEditRef.current = { itemId: '', timestamp: 0 };
        }

        const newItems = curr.project.items.map((item) =>
          item.id === updatedItem.id ? updatedItem : item
        );

        return {
          ...curr,
          project: {
            ...curr.project,
            items: newItems,
            lastModified: now,
          },
          past: nextPast,
          future: [],
        };
      });
    },
    []
  );

  // Undo last translation change
  const handleUndo = useCallback(() => {
    lastEditRef.current = { itemId: '', timestamp: 0 };
    setEditorState((curr) => {
      if (curr.past.length === 0) return curr;

      const previous = curr.past[curr.past.length - 1];
      const nextPast = curr.past.slice(0, -1);

      const currentSnapshot: HistorySnapshot = {
        items: curr.project.items,
        targetLang: curr.project.targetLang,
        targetLocaleName: curr.project.targetLocaleName,
        translationsByLang: curr.project.translationsByLang,
        selectedId: curr.selectedId,
      };

      return {
        project: {
          ...curr.project,
          items: previous.items,
          targetLang: previous.targetLang,
          targetLocaleName: previous.targetLocaleName,
          translationsByLang: previous.translationsByLang,
          lastModified: Date.now(),
        },
        selectedId: previous.selectedId,
        past: nextPast,
        future: [...curr.future, currentSnapshot],
      };
    });
  }, []);

  // Redo previously undone translation change
  const handleRedo = useCallback(() => {
    lastEditRef.current = { itemId: '', timestamp: 0 };
    setEditorState((curr) => {
      if (curr.future.length === 0) return curr;

      const next = curr.future[curr.future.length - 1];
      const nextFuture = curr.future.slice(0, -1);

      const currentSnapshot: HistorySnapshot = {
        items: curr.project.items,
        targetLang: curr.project.targetLang,
        targetLocaleName: curr.project.targetLocaleName,
        translationsByLang: curr.project.translationsByLang,
        selectedId: curr.selectedId,
      };

      return {
        project: {
          ...curr.project,
          items: next.items,
          targetLang: next.targetLang,
          targetLocaleName: next.targetLocaleName,
          translationsByLang: next.translationsByLang,
          lastModified: Date.now(),
        },
        selectedId: next.selectedId,
        past: [...curr.past, currentSnapshot],
        future: nextFuture,
      };
    });
  }, []);

  // Bulk update multiple items in a single undoable snapshot
  const handleBulkUpdateTranslations = useCallback((updatedItems: ResourceItem[]) => {
    if (!updatedItems || updatedItems.length === 0) return;
    lastEditRef.current = { itemId: '', timestamp: 0 };

    setEditorState((curr) => {
      const prev = curr.project;
      const updateMap = new Map<string, ResourceItem>();
      for (const u of updatedItems) {
        updateMap.set(u.id, u);
      }

      const snapshot: HistorySnapshot = {
        items: prev.items,
        targetLang: prev.targetLang,
        targetLocaleName: prev.targetLocaleName,
        translationsByLang: prev.translationsByLang,
        selectedId: curr.selectedId,
      };

      const nextItems = prev.items.map((item) => updateMap.get(item.id) || item);

      return {
        ...curr,
        project: {
          ...prev,
          items: nextItems,
          lastModified: Date.now(),
        },
        past: [...curr.past.slice(-(MAX_HISTORY_STEPS - 1)), snapshot],
        future: [],
      };
    });
  }, []);

  // Reset an individual item's translation and clear its translation history
  const handleResetItemHistory = useCallback((itemId: string) => {
    if (lastEditRef.current.itemId === itemId) {
      lastEditRef.current = { itemId: '', timestamp: 0 };
    }

    const clearItem = (item: ResourceItem): ResourceItem => {
      if (item.id !== itemId) return item;
      if (item.type === 'string') {
        return {
          ...item,
          target: '',
          status: 'untranslated',
          translationSource: undefined,
        };
      }
      if (item.type === 'plural') {
        return {
          ...item,
          items: item.items.map((pi) => ({ ...pi, target: '' })),
          status: 'untranslated',
          translationSource: undefined,
        };
      }
      if (item.type === 'array') {
        return {
          ...item,
          items: item.items.map((ai) => ({ ...ai, target: '' })),
          status: 'untranslated',
          translationSource: undefined,
        };
      }
      return item;
    };

    setEditorState((curr) => {
      const nextItems = curr.project.items.map(clearItem);
      const nextPast = curr.past.map((snap) => ({
        ...snap,
        items: snap.items.map(clearItem),
      }));
      const nextFuture = curr.future.map((snap) => ({
        ...snap,
        items: snap.items.map(clearItem),
      }));

      return {
        ...curr,
        project: {
          ...curr.project,
          items: nextItems,
          lastModified: Date.now(),
        },
        past: nextPast,
        future: nextFuture,
      };
    });
  }, []);

  // Navigation handlers
  const handleNavigatePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setSelectedId(project.items[currentIndex - 1].id);
    }
  }, [currentIndex, project.items, setSelectedId]);

  const handleNavigateNext = useCallback(() => {
    if (currentIndex < project.items.length - 1) {
      setSelectedId(project.items[currentIndex + 1].id);
    }
  }, [currentIndex, project.items, setSelectedId]);

  const handleNavigateNextUntranslated = useCallback(() => {
    const items = project.items;
    // Look forward from currentIndex + 1
    for (let i = currentIndex + 1; i < items.length; i++) {
      if (items[i].status === 'untranslated') {
        setSelectedId(items[i].id);
        return;
      }
    }
    // Loop back from beginning
    for (let i = 0; i <= currentIndex; i++) {
      if (items[i].status === 'untranslated') {
        setSelectedId(items[i].id);
        return;
      }
    }
  }, [currentIndex, project.items, setSelectedId]);

  // Global keyboard shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+Enter, Alt+Left, Alt+Right, Ctrl+J)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z / Cmd+Z (without Shift)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }
      // Redo: Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }
      // Ctrl+Enter or Cmd+Enter: Save & Next
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleNavigateNext();
      }
      // Alt+ArrowRight: Next string
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigateNext();
      }
      // Alt+ArrowLeft: Previous string
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigatePrevious();
      }
      // Ctrl+J or Alt+U: Jump to next untranslated
      if (((e.ctrlKey || e.metaKey) && e.key === 'j') || (e.altKey && e.key.toLowerCase() === 'u')) {
        e.preventDefault();
        handleNavigateNextUntranslated();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleNavigateNext, handleNavigatePrevious, handleNavigateNextUntranslated]);

  // Handle Load Sample Project
  const handleLoadSample = useCallback(() => {
    const sample = createDefaultProject();
    lastEditRef.current = { itemId: '', timestamp: 0 };
    setEditorState({
      project: sample,
      selectedId: sample.items[0]?.id || '',
      past: [],
      future: [],
    });
    setFilterStatus('all');
    setSourceFilter('all');
    setSearchQuery('');
  }, []);

  // Handle Locale Change with translations caching per language so nothing is lost!
  const handleLanguageChange = useCallback((newLocale: string) => {
    lastEditRef.current = { itemId: '', timestamp: 0 };
    setEditorState((curr) => {
      const prev = curr.project;
      const currentLang = prev.targetLang;
      if (currentLang.toLowerCase() === newLocale.toLowerCase()) return curr;

      // Save current state to undo stack before switching language
      const snapshot: HistorySnapshot = {
        items: prev.items,
        targetLang: prev.targetLang,
        targetLocaleName: prev.targetLocaleName,
        translationsByLang: prev.translationsByLang,
        selectedId: curr.selectedId,
      };

      // 1. Cache current items under currentLang
      const updatedCache = {
        ...(prev.translationsByLang || {}),
        [currentLang]: prev.items,
      };

      // 2. Check if new language already has cached translations
      let newItems: ResourceItem[];
      if (updatedCache[newLocale] && updatedCache[newLocale].length === prev.items.length) {
        newItems = normalizePluralsForLanguage(updatedCache[newLocale], newLocale);
      } else if (newLocale === 'es' && SAMPLE_TARGET_SPANISH_XML) {
        const { updatedItems } = mergeTargetXml(prev.items, SAMPLE_TARGET_SPANISH_XML, 'es');
        newItems = updatedItems;
      } else if (newLocale === 'ar' && SAMPLE_TARGET_ARABIC_XML) {
        const { updatedItems } = mergeTargetXml(prev.items, SAMPLE_TARGET_ARABIC_XML, 'ar');
        newItems = updatedItems;
      } else {
        // Fresh blank target translations for this language, normalized for its CLDR plural forms
        const clearedItems = prev.items.map((item) => {
          if (item.type === 'string') {
            return {
              ...item,
              target: '',
              status: 'untranslated' as const,
              translationSource: undefined,
            };
          }
          if (item.type === 'plural') {
            return {
              ...item,
              items: item.items.map((pi) => ({ ...pi, target: '' })),
              status: 'untranslated' as const,
              translationSource: undefined,
            };
          }
          if (item.type === 'array') {
            return {
              ...item,
              items: item.items.map((ai) => ({ ...ai, target: '' })),
              status: 'untranslated' as const,
              translationSource: undefined,
            };
          }
          return item;
        });
        newItems = normalizePluralsForLanguage(clearedItems, newLocale);
      }

      const langOpt = getLanguageOption(newLocale);

      return {
        ...curr,
        project: {
          ...prev,
          targetLang: newLocale,
          targetLocaleName: langOpt.nativeName || langOpt.name || newLocale,
          items: newItems,
          translationsByLang: updatedCache,
          lastModified: Date.now(),
        },
        past: [...curr.past.slice(-(MAX_HISTORY_STEPS - 1)), snapshot],
        future: [],
      };
    });
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#F8F9FA] dark:bg-[#111318] text-slate-900 dark:text-slate-100 font-sans antialiased">
      {/* Material 3 Top Header */}
      <Header
        project={project}
        activeView={activeView}
        onViewChange={setActiveView}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onLoadSample={handleLoadSample}
        onLanguageChange={handleLanguageChange}
        onOpenLanguageModal={() => setIsLanguageModalOpen(true)}
        appLang={appLang}
        onAppLangChange={setAppLang}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        undoCount={past.length}
        redoCount={future.length}
        autoTranslate={autoTranslate}
        onToggleAutoTranslate={handleToggleAutoTranslate}
        onResetItemHistory={handleResetItemHistory}
        onSelectString={(id) => {
          setSelectedId(id);
          setActiveView('editor');
        }}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex min-h-0 relative">
        {activeView === 'editor' ? (
          <>
            {/* Left Sidebar (Desktop / Tablet): Strings List */}
            <div className="hidden md:block w-76 lg:w-84 xl:w-92 shrink-0 h-full">
              <StringList
                items={project.items}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id)}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                filterStatus={filterStatus}
                onFilterChange={setFilterStatus}
                sourceFilter={sourceFilter}
                onSourceFilterChange={setSourceFilter}
                targetLang={project.targetLang}
                targetLocaleName={project.targetLocaleName}
                appLang={appLang}
                onBulkUpdateTranslations={handleBulkUpdateTranslations}
                onResetItemHistory={handleResetItemHistory}
              />
            </div>

            {/* Center: Translation Editor */}
            <main className="flex-1 h-full min-w-0 flex flex-col overflow-hidden relative">
              {/* Mobile Quick Bar for Drawer toggle */}
              <div className="md:hidden flex items-center justify-between px-4 py-2 bg-white dark:bg-[#131314] border-b border-slate-200/80 dark:border-slate-800/80 text-xs">
                <button
                  id="mobile-drawer-btn"
                  onClick={() => setMobileDrawerOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-200 cursor-pointer m3-state-layer"
                >
                  <Menu className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
                  <span>
                    {appLang === 'ar'
                      ? `قائمة النصوص (${project.items.length})`
                      : `Strings List (${project.items.length})`}
                  </span>
                </button>
              </div>

              {currentItem ? (
                <TranslationEditor
                  item={currentItem}
                  currentIndex={currentIndex}
                  totalCount={project.items.length}
                  targetLang={project.targetLang}
                  targetLocaleName={project.targetLocaleName}
                  appLang={appLang}
                  onUpdateTranslation={handleUpdateTranslation}
                  onNavigatePrevious={handleNavigatePrevious}
                  onNavigateNext={handleNavigateNext}
                  onNavigateNextUntranslated={handleNavigateNextUntranslated}
                  onLanguageChange={handleLanguageChange}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  undoCount={past.length}
                  redoCount={future.length}
                  autoTranslate={autoTranslate}
                  onResetItemHistory={handleResetItemHistory}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-400">
                  <p className="text-base font-semibold text-slate-600 dark:text-slate-300">
                    {appLang === 'ar' ? 'لم يتم العثور على نصوص' : 'No strings found'}
                  </p>
                  <p className="text-xs mt-1">
                    {appLang === 'ar'
                      ? 'قم باستيراد ملف strings.xml للبدء.'
                      : 'Import a strings.xml file to get started.'}
                  </p>
                </div>
              )}
            </main>

            {/* Mobile M3 Modal Drawer */}
            {mobileDrawerOpen && (
              <div className="fixed inset-0 z-40 md:hidden flex">
                <div
                  className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
                  onClick={() => setMobileDrawerOpen(false)}
                />
                <div className="relative w-4/5 max-w-sm h-full bg-white dark:bg-[#131314] z-50 flex flex-col shadow-2xl rounded-r-3xl overflow-hidden animate-in slide-in-from-left duration-200">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {appLang === 'ar'
                        ? `دليل النصوص (${project.items.length})`
                        : `Strings Directory (${project.items.length})`}
                    </span>
                    <button
                      onClick={() => setMobileDrawerOpen(false)}
                      className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <StringList
                      items={project.items}
                      selectedId={selectedId}
                      onSelect={(id) => {
                        setSelectedId(id);
                        setMobileDrawerOpen(false);
                      }}
                      searchQuery={searchQuery}
                      onSearchChange={setSearchQuery}
                      filterStatus={filterStatus}
                      onFilterChange={setFilterStatus}
                      sourceFilter={sourceFilter}
                      onSourceFilterChange={setSourceFilter}
                      targetLang={project.targetLang}
                      targetLocaleName={project.targetLocaleName}
                      appLang={appLang}
                      onBulkUpdateTranslations={handleBulkUpdateTranslations}
                      onResetItemHistory={handleResetItemHistory}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Table View */
          <main className="flex-1 h-full overflow-hidden">
            <TableView
              items={project.items}
              onSelectString={(id) => {
                setSelectedId(id);
                setActiveView('editor');
              }}
              onUpdateTranslation={handleUpdateTranslation}
              targetLang={project.targetLang}
              targetLocaleName={project.targetLocaleName}
              appLang={appLang}
              onBulkUpdateTranslations={handleBulkUpdateTranslations}
              onResetItemHistory={handleResetItemHistory}
              filterStatus={filterStatus}
              onFilterChange={setFilterStatus}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              sourceFilter={sourceFilter}
            />
          </main>
        )}
      </div>

      {/* Import Modal */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportComplete={(newProject) => {
          lastEditRef.current = { itemId: '', timestamp: 0 };
          setEditorState({
            project: newProject,
            selectedId: newProject.items[0]?.id || '',
            past: [],
            future: [],
          });
          setFilterStatus('all');
          setSourceFilter('all');
          setSearchQuery('');
        }}
        onLoadSample={handleLoadSample}
        appLang={appLang}
      />

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        project={project}
        filterStatus={filterStatus}
        onFilterChange={setFilterStatus}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        searchQuery={searchQuery}
        appLang={appLang}
      />

      {/* Global Target Language Switcher Dialog */}
      <LanguageSelectorModal
        isOpen={isLanguageModalOpen}
        onClose={() => setIsLanguageModalOpen(false)}
        currentLang={project.targetLang}
        onSelectLanguage={(lang) => handleLanguageChange(lang.code)}
        appLang={appLang}
      />
    </div>
  );
}
