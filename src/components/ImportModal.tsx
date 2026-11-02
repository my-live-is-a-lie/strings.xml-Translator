
import React, { useState } from 'react';
import { X, Upload, FileCode, Sparkles, FolderUp, AlertCircle } from 'lucide-react';
import { useDialog } from '../utils/useDialog';
import { parseAndroidXml, mergeTargetXml, normalizePluralsForLanguage } from '../utils/xmlParser';
import { TranslationProject } from '../types';
import { getArabicLanguageName } from '../utils/languages';
import { useT, tg } from '../i18n/i18n';

// Larger files freeze the page while parsing; real strings.xml files are far smaller than this.
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function importTooLargeMessage(_isAr: boolean): string {
  return tg('the_file_is_too_large');
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (project: TranslationProject) => void;
  onLoadSample: () => void;
  appLang?: 'ar' | 'en';
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  onLoadSample,
  appLang = 'ar',
}) => {
  const { t, tb } = useT();
  const isAr = appLang === 'ar';
  const dialogRef = useDialog(isOpen, onClose);
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [sourceFile, setSourceFile] = useState<{ name: string; content: string } | null>(null);
  const [targetFile, setTargetFile] = useState<{ name: string; content: string } | null>(null);
  const [pastedXml, setPastedXml] = useState('');
  const [targetLang, setTargetLang] = useState('ar');
  const [projectName, setProjectName] = useState('XML Translator');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSourceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setErrorMsg(importTooLargeMessage(isAr));
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setSourceFile({ name: file.name, content: text });
      setErrorMsg(null);
    };
    reader.readAsText(file);
  };

  const handleTargetFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setErrorMsg(importTooLargeMessage(isAr));
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setTargetFile({ name: file.name, content: text });
    };
    reader.readAsText(file);
  };

  const handleProcessImport = () => {
    setErrorMsg(null);
    const xmlToParse = activeTab === 'upload' ? sourceFile?.content : pastedXml;
    const fileName = activeTab === 'upload' ? sourceFile?.name || 'strings.xml' : 'strings.xml';

    if (xmlToParse && xmlToParse.length > MAX_IMPORT_BYTES) {
      setErrorMsg(importTooLargeMessage(isAr));
      return;
    }

    if (!xmlToParse || !xmlToParse.trim()) {
      setErrorMsg(
        t('please_select_or_paste_an')
      );
      return;
    }

    const { items, errors, resourcesAttributes, indentStyle, itemIndentStyle } = parseAndroidXml(xmlToParse);
    if (errors.length > 0 || items.length === 0) {
      setErrorMsg(
        errors.join('\n') ||
          (t('could_not_parse_any_strings'))
      );
      return;
    }

    let finalItems = normalizePluralsForLanguage(items, targetLang);

    // If an existing target translation file was also supplied, merge it!
    if (targetFile?.content) {
      const { updatedItems } = mergeTargetXml(finalItems, targetFile.content, targetLang);
      finalItems = updatedItems;
    }

    const newProject: TranslationProject = {
      id: `proj_${Date.now()}`,
      name: projectName.trim() || (t('android_strings')),
      sourceFileName: fileName,
      sourceLang: 'en',
      targetLang,
      targetLocaleName: isAr ? getArabicLanguageName(targetLang) : getLocaleName(targetLang),
      items: finalItems,
      rawSourceXml: xmlToParse,
      resourcesAttributes,
      indentStyle,
      itemIndentStyle,
      lastModified: Date.now(),
    };

    onImportComplete(newProject);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      {/* Material 3 Dialog Container */}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ImportModal-title" tabIndex={-1} className="outline-none w-full max-w-xl bg-white dark:bg-[#1E1F20] rounded-3xl m3-elevation-3 border border-slate-200/80 dark:border-slate-800/80 overflow-hidden flex flex-col my-6 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#D3E3FD] dark:bg-[#0842A0] flex items-center justify-center text-[#041E49] dark:text-[#D3E3FD]">
              <FolderUp className="w-5 h-5" />
            </div>
            <div>
              <h2 data-i18n id="ImportModal-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('import_strings_xml')}
              </h2>
              <p data-i18n className="text-xs text-slate-600 dark:text-slate-400">
                {t('load_your_android_resource_strings')}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('close')}
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer m3-state-layer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="px-6 py-2 space-y-4 flex-1 overflow-y-auto">
          {/* M3 Segmented Button for Tabs */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-full p-1 border border-slate-200/60 dark:border-slate-700/60">
            <button
              onClick={() => setActiveTab('upload')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-full transition cursor-pointer text-center ${
                activeTab === 'upload'
                  ? 'bg-white dark:bg-[#282B30] text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tb('upload_file_xml')}
            </button>
            <button
              onClick={() => setActiveTab('paste')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-full transition cursor-pointer text-center ${
                activeTab === 'paste'
                  ? 'bg-white dark:bg-[#282B30] text-[#0B57D0] dark:text-[#A8C7FA] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tb('paste_xml_text')}
            </button>
          </div>

          {/* Project & Target Locale Config */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label data-i18n className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('project_name')}
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={t('e_g_my_app_strings')}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/20 transition"
              />
            </div>
            <div>
              <label data-i18n className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('target_language')}
              </label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/20 transition cursor-pointer"
              >
                <option value="ar">{t('arabic_values_ar')}</option>
                <option value="es">{t('spanish_values_es')}</option>
                <option value="fr">{t('french_values_fr')}</option>
                <option value="de">{t('german_values_de')}</option>
                <option value="pt-rBR">
                  {t('portuguese_br_values_pt_rbr')}
                </option>
                <option value="ja">{t('japanese_values_ja')}</option>
                <option value="zh-rCN">
                  {t('chinese_simplified_values_zh_rcn')}
                </option>
                <option value="it">{t('italian_values_it')}</option>
                <option value="ru">{t('russian_values_ru')}</option>
                <option value="hi">{t('hindi_values_hi')}</option>
                <option value="tr">{t('turkish_values_tr')}</option>
                <option value="pl">{t('polish_values_pl')}</option>
              </select>
            </div>
          </div>

          {/* File Upload Tab */}
          {activeTab === 'upload' && (
            <div className="space-y-3 pt-1">
              <div>
                <label data-i18n className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                  {t('1_source_strings_xml_english')}
                </label>
                <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-[#0B57D0] dark:hover:border-[#A8C7FA] rounded-2xl p-5 flex flex-col items-center justify-center gap-2 cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 transition">
                  <Upload className="w-6 h-6 text-slate-400" />
                  <div className="text-center">
                    <span className="text-xs font-semibold text-[#0B57D0] dark:text-[#A8C7FA]">
                      {sourceFile
                        ? sourceFile.name
                        : t('click_to_select_strings_xml')}
                    </span>
                    <p data-i18n className="text-[11px] text-slate-400 mt-0.5">
                      {t('android_xml_file_from_res')}
                    </p>
                  </div>
                  <input
                    type="file"
                    accept=".xml,text/xml"
                    onChange={handleSourceFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label data-i18n className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                  {t('2_existing_target_translation_optional')}
                </label>
                <label className="border border-slate-200 dark:border-slate-700 hover:border-[#0B57D0] rounded-2xl p-3 flex items-center justify-between cursor-pointer bg-slate-50/50 dark:bg-slate-800/20 transition">
                  <div className="flex items-center gap-2.5">
                    <FileCode className="w-4 h-4 text-slate-400" />
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      {targetFile
                        ? targetFile.name
                        : t('merge_existing_target_strings_xml')}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-[#0B57D0] dark:text-[#A8C7FA]">
                    {targetFile
                      ? t('change')
                      : t('browse')}
                  </span>
                  <input
                    type="file"
                    accept=".xml,text/xml"
                    onChange={handleTargetFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Paste Tab */}
          {activeTab === 'paste' && (
            <div className="pt-1">
              <label data-i18n className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                {t('paste_android_strings_xml_content')}
              </label>
              <textarea
                dir="ltr"
                value={pastedXml}
                onChange={(e) => setPastedXml(e.target.value)}
                placeholder={`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">My App</string>\n</resources>`}
                rows={8}
                className="w-full p-3 font-mono text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/20"
              />
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="whitespace-pre-wrap">{errorMsg}</div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-6 pt-4 flex items-center justify-between">
          <button
            onClick={() => {
              onLoadSample();
              onClose();
            }}
            className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span data-i18n>{t('load_sample_app')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
            >
              {tb('cancel')}
            </button>
            <button
              onClick={handleProcessImport}
              className="px-5 py-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#A8C7FA] dark:hover:bg-[#82AAFA] text-white dark:text-[#062E6F] text-xs font-semibold shadow-xs transition cursor-pointer m3-state-layer"
            >
              {tb('start_translating')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function getLocaleName(code: string): string {
  const map: Record<string, string> = {
    es: 'Spanish',
    ar: 'Arabic',
    fr: 'French',
    de: 'German',
    'pt-rBR': 'Portuguese (Brazil)',
    ja: 'Japanese',
    'zh-rCN': 'Chinese (Simplified)',
    it: 'Italian',
    ru: 'Russian',
    hi: 'Hindi',
    tr: 'Turkish',
    pl: 'Polish',
  };
  return map[code] || code;
}
