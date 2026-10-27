import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { applyAppTheme, getInitialAppTheme, AppTheme } from './utils/theme';
import { applyAppDirection } from './utils/direction';
import { StringList } from './components/StringList';
import { StringsListDrawer } from './components/StringsListDrawer';
import { TranslationEditor } from './components/TranslationEditor';
import { TableView } from './components/TableView';
import { ImportModal } from './components/ImportModal';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { ShortcutsModal } from './components/ShortcutsModal';
import { UpdateSourceModal } from './components/UpdateSourceModal';
import { MultiLanguageModal } from './components/MultiLanguageModal';
import {
  EditorState,
  HistorySnapshot,
  MAX_HISTORY_STEPS,
  bulkUpdate,
  changeLanguage,
  saveLanguages,
  updateSource,
} from './utils/editorState';
import { ExportModal } from './components/ExportModal';
import { FilesModal } from './components/FilesModal';
import { QuickFilterButton, QuickFilterBar } from './components/QuickFilters';
import { TranslationProject, ResourceItem, FilterStatus, SourceFilter, StoredXmlFile } from './types';
import { parseAndroidXml, mergeTargetXml, normalizePluralsForLanguage } from './utils/xmlParser';
import { SAMPLE_ANDROID_STRINGS_XML, SAMPLE_TARGET_ARABIC_XML } from './utils/sampleData';
import { saveCurrentProject, loadCurrentProject, getStoredItem, setStoredItem } from './utils/storage';
import {
  getStoredFiles,
  saveStoredFiles,
  getActiveFileId,
  setActiveFileId,
  hasItemsChanged,
  deleteStoredFile,
  renameStoredFile,
  resetStoredFileToOriginal,
  extractAppNameFromItems,
} from './utils/filesStorage';
import { LanguageSelectorModal } from './components/LanguageSelectorModal';
import {
  getAutoTranslateEnabled,
  setAutoTranslateEnabled,
} from './utils/translator';
import { Menu } from 'lucide-react';

const TYPING_COALESCE_MS = 700;

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
    let { source } = item;
    const target = item.target;

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
  const [storedFiles, setStoredFiles] = useState<StoredXmlFile[]>(() => getStoredFiles());
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);

  const [editorState, setEditorState] = useState<EditorState>(() => {
    const initialStored = getStoredFiles();
    const savedActiveId = getActiveFileId();
    let initialProject: TranslationProject;
    let initialActiveFile: StoredXmlFile | undefined;

    if (initialStored.length > 0) {
      initialActiveFile = initialStored.find((f) => f.id === savedActiveId) || initialStored[0];
      initialProject = initialActiveFile.project;
    } else {
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

  // Track original unedited state of the active file for reset & edit detection
  const originalFileStateRef = useRef<{ fileId: string; rawXml?: string; items: ResourceItem[] }>({
    fileId: project.id,
    rawXml: project.rawSourceXml,
    items: structuredClone(project.items),
  });

  // Keep originalFileStateRef synchronized with current project when project.id changes
  useEffect(() => {
    if (originalFileStateRef.current.fileId !== project.id) {
      const stored = getStoredFiles().find((f) => f.id === project.id);
      if (stored) {
        originalFileStateRef.current = {
          fileId: stored.id,
          rawXml: stored.originalRawXml,
          items: structuredClone(stored.originalItems),
        };
      } else {
        originalFileStateRef.current = {
          fileId: project.id,
          rawXml: project.rawSourceXml,
          items: structuredClone(project.items),
        };
      }
    }
  }, [project.id, project.rawSourceXml, project.items]);

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
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isMultiLangOpen, setIsMultiLangOpen] = useState(false);
  const openMultiLang = useCallback(() => setIsMultiLangOpen(true), []);
  const closeMultiLang = useCallback(() => setIsMultiLangOpen(false), []);
  const [isUpdateSourceOpen, setIsUpdateSourceOpen] = useState(false);
  const openUpdateSource = useCallback(() => setIsUpdateSourceOpen(true), []);
  const closeUpdateSource = useCallback(() => setIsUpdateSourceOpen(false), []);
  const openShortcuts = useCallback(() => setIsShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setIsShortcutsOpen(false), []);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [appLang, setAppLang] = useState<'ar' | 'en'>(() => {
    const saved = getStoredItem('app_ui_language');
    return saved === 'en' ? 'en' : 'ar';
  });
  const [appTheme, setAppTheme] = useState<AppTheme>(() => getInitialAppTheme());

  useEffect(() => {
    applyAppTheme(appTheme);
  }, [appTheme]);

  const [autoTranslate, setAutoTranslate] = useState<boolean>(() => getAutoTranslateEnabled());

  const handleToggleAutoTranslate = useCallback((enabled: boolean) => {
    setAutoTranslate(enabled);
    setAutoTranslateEnabled(enabled);
  }, []);

  useEffect(() => {
    setStoredItem('app_ui_language', appLang);
    // Mirror the whole layout for right-to-left interface languages (Arabic).
    applyAppDirection(appLang);
  }, [appLang]);

  // Auto-save project locally on change and sync to stored files if modified
  // Saved-file bookkeeping runs after edits settle (300 ms), not on every keystroke.
  // State is computed from a ref and side effects run outside the state updater, so React's
  // StrictMode double-invocation cannot repeat writes or corrupt state.
  const storedFilesRef = useRef(storedFiles);
  useEffect(() => {
    storedFilesRef.current = storedFiles;
  }, [storedFiles]);

  useEffect(() => {
    saveCurrentProject(project);

    const timer = setTimeout(() => {
      const prev = storedFilesRef.current;
      const existingIndex = prev.findIndex((f) => f.id === project.id);

      // Check if user has made any changes compared to original imported file
      const origItems = originalFileStateRef.current.fileId === project.id
        ? originalFileStateRef.current.items
        : [];
      const hasChanges = origItems.length > 0 && hasItemsChanged(project.items, origItems);

      let next: StoredXmlFile[] | null = null;
      if (hasChanges) {
        const baseOrigItems = origItems;
        const existingAppName = existingIndex >= 0 ? prev[existingIndex].appName : undefined;
        const detectedAppName = existingAppName || extractAppNameFromItems(baseOrigItems) || extractAppNameFromItems(project.items);
        const updatedFile: StoredXmlFile = {
          id: project.id,
          name: project.sourceFileName || project.name || 'strings.xml',
          appName: detectedAppName,
          importedAt: existingIndex >= 0 ? prev[existingIndex].importedAt : Date.now(),
          lastModified: Date.now(),
          originalRawXml: originalFileStateRef.current.rawXml,
          originalItems: baseOrigItems,
          project: project,
          hasUserEdits: true,
        };
        next = existingIndex >= 0
          ? prev.map((f, i) => (i === existingIndex ? updatedFile : f))
          : [updatedFile, ...prev];
        setActiveFileId(project.id);
      } else if (existingIndex >= 0) {
        // Already saved: keep its project in sync
        const curr = prev[existingIndex];
        const appName = curr.appName || extractAppNameFromItems(curr.originalItems) || extractAppNameFromItems(project.items);
        next = prev.map((f, i) =>
          i === existingIndex ? { ...curr, appName, project: project, lastModified: Date.now() } : f
        );
      }

      if (next) {
        saveStoredFiles(next);
        storedFilesRef.current = next;
        setStoredFiles(next);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [project]);

  // If selectedId is invalid, default to first item
  if (project.items.length > 0 && !project.items.some((i) => i.id === selectedId)) {
    // Own-state update during render (React re-renders once with the corrected selection)
    setEditorState((prev) => ({ ...prev, selectedId: prev.project.items[0]?.id ?? prev.selectedId }));
  }

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
          targetLocaleName: previous.targetLocaleName ?? curr.project.targetLocaleName,
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
          targetLocaleName: next.targetLocaleName ?? curr.project.targetLocaleName,
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
  // Keep languages translated in bulk so they can be opened later from the language picker
  const handleSaveLanguages = useCallback((byLang: Record<string, ResourceItem[]>) => {
    setEditorState((curr) => saveLanguages(curr, byLang));
  }, []);

  // Apply a newer source file: keep translations, flag changed strings for review, drop removed ones
  const handleApplySourceUpdate = useCallback(
    (parsed: { items: ResourceItem[]; resourcesAttributes?: string; indentStyle?: string; itemIndentStyle?: string }, rawXml: string) => {
      lastEditRef.current = { itemId: '', timestamp: 0 };
      setEditorState((curr) => updateSource(curr, parsed, rawXml));
    },
    []
  );

  const handleBulkUpdateTranslations = useCallback((updatedItems: ResourceItem[]) => {
    if (!updatedItems || updatedItems.length === 0) return;
    lastEditRef.current = { itemId: '', timestamp: 0 };
    setEditorState((curr) => bulkUpdate(curr, updatedItems));
  }, []);

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

  useGlobalShortcuts({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onNext: handleNavigateNext,
    onPrevious: handleNavigatePrevious,
    onNextUntranslated: handleNavigateNextUntranslated,
    onShowHelp: openShortcuts,
  });

  // Handle Load Sample Project
  const handleLoadSample = useCallback(() => {
    const sample = createDefaultProject();
    lastEditRef.current = { itemId: '', timestamp: 0 };
    originalFileStateRef.current = {
      fileId: sample.id,
      rawXml: sample.rawSourceXml,
      items: structuredClone(sample.items),
    };
    setActiveFileId(sample.id);
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

  // File management actions: Switch, Rename, Reset, Delete
  const handleSelectFile = useCallback((fileId: string) => {
    const targetFile = storedFiles.find((f) => f.id === fileId);
    if (!targetFile) return;

    lastEditRef.current = { itemId: '', timestamp: 0 };
    originalFileStateRef.current = {
      fileId: targetFile.id,
      rawXml: targetFile.originalRawXml,
      items: structuredClone(targetFile.originalItems),
    };
    setActiveFileId(targetFile.id);

    setEditorState({
      project: targetFile.project,
      selectedId: targetFile.project.items[0]?.id || '',
      past: [],
      future: [],
    });
    setFilterStatus('all');
    setSourceFilter('all');
    setSearchQuery('');
  }, [storedFiles]);

  const handleRenameFile = useCallback((fileId: string, newName: string) => {
    const updated = renameStoredFile(fileId, newName);
    setStoredFiles(updated);
    if (project.id === fileId) {
      setEditorState((prev) => ({
        ...prev,
        project: {
          ...prev.project,
          name: newName,
          sourceFileName: newName,
        },
      }));
    }
  }, [project.id]);

  const handleResetFile = useCallback((fileId: string) => {
    const { files: updated, resetFile } = resetStoredFileToOriginal(fileId);
    setStoredFiles(updated);
    if (resetFile && project.id === fileId) {
      originalFileStateRef.current = {
        fileId: resetFile.id,
        rawXml: resetFile.originalRawXml,
        items: structuredClone(resetFile.originalItems),
      };
      setEditorState({
        project: resetFile.project,
        selectedId: resetFile.project.items[0]?.id || '',
        past: [],
        future: [],
      });
    }
  }, [project.id]);

  const handleDeleteFile = useCallback((fileId: string) => {
    const updated = deleteStoredFile(fileId);
    setStoredFiles(updated);
    if (project.id === fileId) {
      if (updated.length > 0) {
        handleSelectFile(updated[0].id);
      } else {
        const defaultProj = createDefaultProject();
        originalFileStateRef.current = {
          fileId: defaultProj.id,
          rawXml: defaultProj.rawSourceXml,
          items: structuredClone(defaultProj.items),
        };
        setActiveFileId(defaultProj.id);
        setEditorState({
          project: defaultProj,
          selectedId: defaultProj.items[0]?.id || '',
          past: [],
          future: [],
        });
      }
    }
  }, [project.id, handleSelectFile]);

  // Handle Locale Change with translations caching per language so nothing is lost!
  const handleLanguageChange = useCallback((newLocale: string) => {
    lastEditRef.current = { itemId: '', timestamp: 0 };
    setEditorState((curr) => changeLanguage(curr, newLocale));
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // Stable callbacks: child components can skip re-rendering when unrelated state changes
  const openImport = useCallback(() => setIsImportOpen(true), []);
  const openExport = useCallback(() => setIsExportOpen(true), []);
  const openLanguageModal = useCallback(() => setIsLanguageModalOpen(true), []);
  const openFilesModal = useCallback(() => setIsFilesModalOpen(true), []);
  const openMobileDrawer = useCallback(() => setMobileDrawerOpen(true), []);
  const closeMobileDrawer = useCallback(() => setMobileDrawerOpen(false), []);
  const selectItem = useCallback((id: string) => setSelectedId(id), [setSelectedId]);
  const selectItemInEditor = useCallback(
    (id: string) => {
      setSelectedId(id);
      setActiveView('editor');
    },
    [setSelectedId]
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-app text-app font-sans antialiased">
      {/* Material 3 Top Header */}
      <Header
        project={project}
        activeView={activeView}
        onViewChange={setActiveView}
        onOpenImport={openImport}
        onOpenExport={openExport}
        onLoadSample={handleLoadSample}
        onLanguageChange={handleLanguageChange}
        onOpenLanguageModal={openLanguageModal}
        appLang={appLang}
        onAppLangChange={setAppLang}
        appTheme={appTheme}
        onAppThemeChange={setAppTheme}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        undoCount={past.length}
        redoCount={future.length}
        autoTranslate={autoTranslate}
        onToggleAutoTranslate={handleToggleAutoTranslate}
        onResetItemHistory={handleResetItemHistory}
        onSelectString={selectItemInEditor}
        onOpenFilesModal={openFilesModal}
        onOpenShortcuts={openShortcuts}
        onOpenUpdateSource={openUpdateSource}
        onOpenMultiLang={openMultiLang}
        savedFilesCount={storedFiles.length}
        currentFileName={project.sourceFileName || project.name}
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
                onSelect={selectItem}
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
              <div className="md:hidden flex flex-col gap-2 px-4 pt-0.5 pb-2 bg-white/95 dark:bg-[#131314]/95 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                <button
                  id="mobile-drawer-btn"
                  onClick={openMobileDrawer}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent shadow-sm font-medium text-slate-800 dark:text-slate-200 cursor-pointer m3-state-layer"
                >
                  <Menu className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
                  <span>
                    {appLang === 'ar'
                      ? `قائمة النصوص (${project.items.length})`
                      : `Strings List (${project.items.length})`}
                  </span>
                </button>
                <QuickFilterButton appLang={appLang} />
                </div>
                <QuickFilterBar appLang={appLang} />
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

            {/* Mobile Strings List Drawer - identical snappy 200ms motion & feel matching the side drawer */}
            <StringsListDrawer
              isOpen={mobileDrawerOpen}
              onClose={closeMobileDrawer}
              items={project.items}
              selectedId={selectedId}
              onSelect={selectItemInEditor}
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
          </>
        ) : (
          /* Table View */
          <main className="flex-1 h-full overflow-hidden">
            <TableView
              items={project.items}
              onSelectString={selectItemInEditor}
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
      <MultiLanguageModal
        isOpen={isMultiLangOpen}
        onClose={closeMultiLang}
        project={project}
        onSaveLanguages={handleSaveLanguages}
        appLang={appLang}
      />
      <UpdateSourceModal
        isOpen={isUpdateSourceOpen}
        onClose={closeUpdateSource}
        project={project}
        onApply={handleApplySourceUpdate}
        appLang={appLang}
      />
      <ShortcutsModal isOpen={isShortcutsOpen} onClose={closeShortcuts} appLang={appLang} />
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportComplete={(newProject) => {
          lastEditRef.current = { itemId: '', timestamp: 0 };
          originalFileStateRef.current = {
            fileId: newProject.id,
            rawXml: newProject.rawSourceXml,
            items: structuredClone(newProject.items),
          };
          setActiveFileId(newProject.id);
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

      {/* Stored XML Files Modal */}
      <FilesModal
        isOpen={isFilesModalOpen}
        onClose={() => setIsFilesModalOpen(false)}
        storedFiles={storedFiles}
        activeFileId={project.id}
        currentProject={project}
        onSelectFile={handleSelectFile}
        onRenameFile={handleRenameFile}
        onDeleteFile={handleDeleteFile}
        onResetFile={handleResetFile}
        onOpenImport={openImport}
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
