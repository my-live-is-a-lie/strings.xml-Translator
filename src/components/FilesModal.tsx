import React, { useState } from 'react';
import {
  X,
  FileCode2,
  Edit2,
  Trash2,
  RotateCcw,
  Check,
  Plus,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { StoredXmlFile, TranslationProject } from '../types';
import { extractAppNameFromItems } from '../utils/filesStorage';

interface FilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  storedFiles: StoredXmlFile[];
  activeFileId: string | null;
  currentProject: TranslationProject;
  onSelectFile: (fileId: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onDeleteFile: (fileId: string) => void;
  onResetFile: (fileId: string) => void;
  onOpenImport: () => void;
  appLang?: 'ar' | 'en';
}

export const FilesModal: React.FC<FilesModalProps> = ({
  isOpen,
  onClose,
  storedFiles,
  activeFileId,
  currentProject,
  onSelectFile,
  onRenameFile,
  onDeleteFile,
  onResetFile,
  onOpenImport,
  appLang = 'ar',
}) => {
  const isAr = appLang === 'ar';

  // Inline editing state for renaming
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  // Confirmation dialogs state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);

  // Dynamic measuring for auto-expanding input box
  const measureSpanRef = React.useRef<HTMLSpanElement>(null);
  const editInputRef = React.useRef<HTMLTextAreaElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(140);

  React.useEffect(() => {
    if (editingFileId && measureSpanRef.current) {
      const w = measureSpanRef.current.getBoundingClientRect().width;
      setMeasuredWidth(Math.ceil(w) + 26);
    }
  }, [editNameValue, editingFileId]);

  React.useEffect(() => {
    if (editingFileId && editInputRef.current) {
      const el = editInputRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = 'auto';
      el.style.height = `${Math.min(52, Math.max(26, el.scrollHeight))}px`;
    }
  }, [editingFileId]);

  if (!isOpen) return null;

  const handleStartRename = (file: StoredXmlFile) => {
    setEditingFileId(file.id);
    setEditNameValue(file.name);
    setConfirmDeleteId(null);
    setConfirmResetId(null);
  };

  const handleSaveRename = (fileId: string) => {
    const trimmed = editNameValue.trim();
    if (trimmed && trimmed.length > 0) {
      onRenameFile(fileId, trimmed);
    }
    setEditingFileId(null);
    setEditNameValue('');
  };

  const handleCancelRename = () => {
    setEditingFileId(null);
    setEditNameValue('');
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return isAr ? 'الآن' : 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return isAr ? `منذ ${minutes} دقيقة` : `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return isAr ? `منذ ${hours} ساعة` : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return isAr ? `منذ ${days} يوم` : `${days}d ago`;
  };

  const getStats = (file: StoredXmlFile) => {
    const items = file.project.items;
    const total = items.length;
    let translated = 0;
    for (const item of items) {
      if (item.status === 'translated') {
        translated++;
      } else if (item.type === 'string' && item.target && item.target.trim().length > 0) {
        translated++;
      }
    }
    const percent = total > 0 ? Math.round((translated / total) * 100) : 0;
    return { total, translated, percent };
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="files-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#161B26] border border-slate-200 dark:border-[#263143] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200/80 dark:border-[#242E3E]">
          <div className="flex items-center gap-2.5">
            <button
              id="add-file-header-btn"
              type="button"
              onClick={() => {
                onClose();
                onOpenImport();
              }}
              className="w-8 h-8 rounded-lg bg-[#0B57D0]/10 hover:bg-[#0B57D0]/20 dark:bg-[#1EB996]/15 dark:hover:bg-[#1EB996]/25 flex items-center justify-center text-[#0B57D0] dark:text-[#1EB996] transition cursor-pointer"
              title={isAr ? 'استيراد ملف إضافي' : 'Import another file'}
              aria-label={isAr ? 'استيراد ملف إضافي' : 'Import another file'}
            >
              <Plus className="w-4 h-4" />
            </button>
            <h2 id="files-modal-title" className="text-base font-bold tracking-tight">
              {isAr ? 'المشاريع' : 'Projects'}
            </h2>
          </div>

          <button
            id="close-files-modal-btn"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#202938] transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-0 space-y-3.5">
          {storedFiles.length === 0 ? (
            <div className="text-center py-10 px-4 rounded-xl border border-dashed border-slate-200 dark:border-[#2A364A] bg-slate-50/50 dark:bg-[#1A212E]/50">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-[#202938] flex items-center justify-center mx-auto mb-3 text-slate-400">
                <FileCode2 className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold mb-1">
                {isAr ? 'لا توجد ملفات معدلة محفوظة بعد' : 'No saved files yet'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4 leading-relaxed">
                {isAr
                  ? 'الملف المستورد يتم حفظه وتخزينه تلقائياً في هذه القائمة بمجرد إجراء أي تعديل على نصوصه. يمكنك بعدها التبديل بين عدة ملفات دون فقدان عملك.'
                  : 'Imported files are automatically saved and synced here as soon as you make any edits. You can then switch between multiple files without losing work.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenImport();
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#1EB996] dark:hover:bg-[#19A585] text-white text-xs font-semibold transition cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>{isAr ? 'استيراد ملف XML الآن' : 'Import XML File Now'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {storedFiles.map((file) => {
                const isActive = file.id === activeFileId;
                const stats = getStats(file);
                const isEditingThis = editingFileId === file.id;
                const isConfirmingDelete = confirmDeleteId === file.id;
                const isConfirmingReset = confirmResetId === file.id;
                const appName = file.appName || extractAppNameFromItems(file.originalItems) || extractAppNameFromItems(file.project?.items);

                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      if (!isActive && !isEditingThis && !isConfirmingDelete && !isConfirmingReset) {
                        onSelectFile(file.id);
                        onClose();
                      }
                    }}
                    className={`relative rounded-xl border transition p-3 sm:p-3.5 group ${
                      isActive
                        ? 'border-[#0B57D0] dark:border-[#1EB996] bg-[#0B57D0]/5 dark:bg-[#1EB996]/5 ring-1 ring-[#0B57D0]/30 dark:ring-[#1EB996]/30'
                        : 'border-slate-200 dark:border-[#263143] bg-slate-50/70 dark:bg-[#1B2230] hover:border-[#0B57D0]/60 dark:hover:border-[#1EB996]/60 hover:bg-slate-100/80 dark:hover:bg-[#1F2737] cursor-pointer'
                    }`}
                  >
                    {/* Top Row: File Name & Quick Icon Actions */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        {isEditingThis ? (
                          <div
                            className="flex items-start gap-1.5 flex-1 min-w-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <textarea
                              ref={editInputRef}
                              rows={1}
                              value={editNameValue}
                              onChange={(e) => {
                                const val = e.target.value.replace(/[\r\n]/g, '');
                                setEditNameValue(val);
                                e.target.style.height = 'auto';
                                e.target.style.height = `${Math.min(52, Math.max(26, e.target.scrollHeight))}px`;
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveRename(file.id);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  handleCancelRename();
                                }
                              }}
                              dir="auto"
                              style={{
                                width: `${Math.max(130, measuredWidth)}px`,
                              }}
                              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[#0B57D0] dark:border-[#1EB996] bg-white dark:bg-[#121620] text-slate-900 dark:text-white outline-none resize-none overflow-hidden max-w-[calc(100%-58px)] max-h-[52px] leading-snug shadow-xs [field-sizing:content] transition-[width] duration-75 line-clamp-2"
                            />
                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                              <button
                                type="button"
                                onClick={() => handleSaveRename(file.id)}
                                className="p-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer shadow-xs"
                                title={isAr ? 'حفظ' : 'Save'}
                                aria-label={isAr ? 'حفظ الاسم' : 'Save Name'}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelRename}
                                className="p-1 rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                                title={isAr ? 'إلغاء' : 'Cancel'}
                                aria-label={isAr ? 'إلغاء' : 'Cancel'}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-1.5 min-w-0">
                              <span
                                className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white line-clamp-2 break-words [word-break:break-word] leading-snug"
                                title={file.name}
                              >
                                {file.name}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartRename(file);
                                }}
                                className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-[#263143] transition cursor-pointer shrink-0 mt-0.5"
                                title={isAr ? 'إعادة التسمية' : 'Rename'}
                                aria-label={isAr ? 'إعادة تسمية' : 'Rename'}
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                            {appName && (
                              <div
                                className="text-[11px] text-[#0B57D0] dark:text-[#1EB996] font-medium truncate mt-0.5 tracking-tight"
                                title={appName}
                              >
                                {appName}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right icons: reset / delete icons (hidden while renaming this item to allow full expansion) */}
                      {!isEditingThis && (
                        <div
                          className="flex items-center gap-1.5 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Reset icon button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmResetId(file.id);
                              setConfirmDeleteId(null);
                            }}
                            className="p-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 transition cursor-pointer"
                            title={isAr ? 'استعادة الحالة الأصلية للملف' : 'Reset to original state'}
                            aria-label={isAr ? 'استعادة الأصل' : 'Reset to original'}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete icon button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(file.id);
                              setConfirmResetId(null);
                            }}
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/15 transition cursor-pointer"
                            title={isAr ? 'حذف الملف' : 'Delete file'}
                            aria-label={isAr ? 'حذف' : 'Delete'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Progress Bar & Stats */}
                    <div className="mt-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        <div className="flex items-center gap-2">
                          <span>
                            {isAr
                              ? `${stats.translated} من ${stats.total}`
                              : `${stats.translated} of ${stats.total}`}
                          </span>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#0B57D0]/10 dark:bg-[#1EB996]/20 text-[#0B57D0] dark:text-[#1EB996]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#0B57D0] dark:bg-[#1EB996]" />
                              <span>{isAr ? 'النشط' : 'Active'}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">
                            {stats.percent}%
                          </span>
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            <span>{formatTimeAgo(file.lastModified)}</span>
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-[#283244] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0B57D0] dark:bg-[#1EB996] rounded-full transition-all duration-300"
                          style={{ width: `${stats.percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Inline Confirmation Prompts */}
                    {isConfirmingReset && (
                      <div
                        className="mt-2.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                          <span className="truncate">
                            {isAr ? 'استعادة الحالة الأصلية للملف؟' : 'Reset to original state?'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onResetFile(file.id);
                              setConfirmResetId(null);
                            }}
                            className="p-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white transition cursor-pointer"
                            title={isAr ? 'تأكيد الاستعادة' : 'Confirm Reset'}
                            aria-label={isAr ? 'تأكيد الاستعادة' : 'Confirm Reset'}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmResetId(null);
                            }}
                            className="p-1.5 rounded bg-slate-200 dark:bg-[#283244] text-slate-700 dark:text-slate-300 transition cursor-pointer"
                            title={isAr ? 'إلغاء' : 'Cancel'}
                            aria-label={isAr ? 'إلغاء' : 'Cancel'}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {isConfirmingDelete && (
                      <div
                        className="mt-2.5 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2 text-xs text-rose-700 dark:text-rose-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                          <span className="truncate">
                            {isAr ? 'حذف هذا الملف نهائياً؟' : 'Delete file permanently?'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteFile(file.id);
                              setConfirmDeleteId(null);
                            }}
                            className="p-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer"
                            title={isAr ? 'تأكيد الحذف' : 'Confirm Delete'}
                            aria-label={isAr ? 'تأكيد الحذف' : 'Confirm Delete'}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            className="p-1.5 rounded bg-slate-200 dark:bg-[#283244] text-slate-700 dark:text-slate-300 transition cursor-pointer"
                            title={isAr ? 'إلغاء' : 'Cancel'}
                            aria-label={isAr ? 'إلغاء' : 'Cancel'}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* Hidden mirror span to accurately measure typed text width in px */}
        <span
          ref={measureSpanRef}
          className="invisible fixed -top-[9999px] -left-[9999px] pointer-events-none whitespace-pre text-xs font-semibold px-2.5 select-none"
          aria-hidden="true"
        >
          {editNameValue || 'strings.xml'}
        </span>
      </div>
    </div>
  );
};
