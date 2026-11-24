
import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, FileCode, AlertCircle, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { useDialog } from '../utils/useDialog';
import { mergeTargetXml, normalizePluralsForLanguage, parseAndroidXml, ParsedXmlResult } from '../utils/xmlParser';
import {
  applyReviewDecisions,
  applySilentFixes,
  checkTargetFileIcu,
  isEntryExclusion,
  isFixableIssue,
  repairAndroidXml,
  RepairIssue,
  RepairResult,
  RESOURCE_TAG_BY_TYPE,
} from '../utils/xmlRepair';
import { TranslationProject } from '../types';
import { getArabicLanguageName } from '../utils/languages';
import { suggestedProjectName } from '../utils/multiLang';
import { useT, tg } from '../i18n/i18n';

type Translate = (key: string, ...args: unknown[]) => string;

// Localizes a RepairIssue's description by its `category` + `params` instead of showing the
// English `message` xmlRepair.ts built for itself — see issue #25. Uses the app's existing
// positional `%1$s` placeholders (handled by `t`) rather than a second, hand-rolled `{name}` syntax.
// Falls back to that English message only for a category this UI doesn't know how to phrase yet
// (in practice: raw parser errors, which have no stable wording to translate).

/** ICU review findings with one message key, shared by the source report and the merged translation file. */
const ICU_REVIEW_KEY_BY_KIND: Record<string, string> = {
  'unmatched-brace': 'repair_unmatched_brace',
  'suspect-icu-keyword': 'repair_suspect_icu_keyword',
  'missing-other-branch': 'repair_missing_other_branch',
  'duplicate-icu-category': 'repair_duplicate_icu_category',
};

function localizeRepairIssue(issue: RepairIssue, t: Translate): string {
  const count = issue.params?.count ?? '';
  const name = issue.stringName ?? issue.params?.name ?? '';
  const tagWord = (issue.resourceType && RESOURCE_TAG_BY_TYPE[issue.resourceType]) || 'string';

  switch (issue.category) {
    case 'bom':
      return t('repair_bom');
    case 'zero-width-chars':
      return t('repair_zero_width', count);
    case 'line-endings':
      return t('repair_line_endings', count);
    case 'bare-ampersand':
      return t('repair_bare_ampersand', count);
    case 'html-entity':
      return t('repair_html_entity', count);
    case 'unescaped-apostrophe': {
      const base = t('repair_unescaped_apostrophe', name, count);
      if (issue.resourceType === 'plural' && issue.itemQualifier) {
        return `${base} ${t('repair_location_plural', issue.itemQualifier)}`;
      }
      if (issue.resourceType === 'array' && issue.itemQualifier !== undefined) {
        return `${base} ${t('repair_location_array', String(Number(issue.itemQualifier) + 1))}`;
      }
      return base;
    }
    case 'duplicate-name':
      return t('repair_duplicate_name', name, count);
    case 'undefined-entity':
      return t('repair_undefined_entity', issue.params?.names ?? '');
    case 'no-strings':
      return t('could_not_parse_any_strings');
    case 'malformed-entry':
      return issue.stringName
        ? t('repair_malformed_entry_named', tagWord, issue.stringName)
        : t('repair_malformed_entry_unnamed', tagWord);
    case 'target-icu': {
      const kind = String(issue.params?.kind ?? '');
      const detail = issue.params?.detail ?? '';
      const arg = issue.params?.arg ?? '';
      const own: Record<string, string> = {
        'unterminated-icu-quote': 'repair_target_unterminated_icu_quote',
        'unbalanced-icu-block': 'repair_target_unbalanced_icu_block',
        'unknown-icu-keyword': 'repair_target_unknown_icu_keyword',
        'missing-other-branch': 'repair_target_missing_other_branch',
        'escaped-apostrophe-quote': 'repair_target_escaped_apostrophe_quote',
      };
      const body =
        kind === 'mixed-placeholders'
          ? t('repair_mixed_placeholders', name, issue.params?.printf ?? '', issue.params?.icu ?? '')
          : own[kind]
            ? t(own[kind], name, detail, arg)
            : ICU_REVIEW_KEY_BY_KIND[kind]
              ? t(ICU_REVIEW_KEY_BY_KIND[kind], name, detail, arg)
              : issue.message;
      const where =
        issue.resourceType === 'array' && issue.itemQualifier !== undefined
          ? ` ${t('repair_location_array', String(Number(issue.itemQualifier) + 1))}`
          : '';
      return `${t('repair_target_prefix')} ${body}${where}`;
    }
    case 'mixed-placeholders': {
      const base = t('repair_mixed_placeholders', name, issue.params?.printf ?? '', issue.params?.icu ?? '');
      return issue.resourceType === 'array' && issue.itemQualifier !== undefined
        ? `${base} ${t('repair_location_array', String(Number(issue.itemQualifier) + 1))}`
        : base;
    }
    case 'escaped-apostrophe-quote':
    case 'icu-exclusion-failed': {
      const base = t(
        issue.category === 'escaped-apostrophe-quote' ? 'repair_escaped_apostrophe_quote' : 'repair_icu_exclusion_failed',
        name
      );
      return issue.resourceType === 'array' && issue.itemQualifier !== undefined
        ? `${base} ${t('repair_location_array', String(Number(issue.itemQualifier) + 1))}`
        : base;
    }
    case 'unterminated-icu-quote':
      return issue.resourceType === 'array' && issue.itemQualifier !== undefined
        ? t('repair_unterminated_icu_quote_array', name, String(Number(issue.itemQualifier) + 1))
        : t('repair_unterminated_icu_quote', name);
    case 'unbalanced-icu-block':
    case 'unknown-icu-keyword': {
      const key = issue.category === 'unbalanced-icu-block' ? 'repair_unbalanced_icu_block' : 'repair_unknown_icu_keyword';
      const base = t(key, name, issue.params?.detail ?? '');
      return issue.resourceType === 'array' && issue.itemQualifier !== undefined
        ? `${base} ${t('repair_location_array', String(Number(issue.itemQualifier) + 1))} ${t('repair_array_left_out')}`
        : base;
    }
    case 'unmatched-brace':
    case 'suspect-icu-keyword':
    case 'missing-other-branch':
    case 'duplicate-icu-category': {
      const base = t(ICU_REVIEW_KEY_BY_KIND[issue.category], name, issue.params?.detail ?? '', issue.params?.arg ?? '');
      return issue.resourceType === 'array' && issue.itemQualifier !== undefined
        ? `${base} ${t('repair_location_array', String(Number(issue.itemQualifier) + 1))}`
        : base;
    }
    case 'missing-name':
      return t('repair_missing_name', tagWord);
    default:
      return issue.message;
  }
}

// Larger files freeze the page while parsing; real strings.xml files are far smaller than this.
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const FOOTER_SECONDARY_BTN =
  'py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer';
const FOOTER_PRIMARY_BTN =
  'px-5 py-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#A8C7FA] dark:hover:bg-[#82AAFA] text-white dark:text-[#062E6F] text-xs font-semibold shadow-xs transition cursor-pointer m3-state-layer';

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
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [sourceFile, setSourceFile] = useState<{ name: string; content: string } | null>(null);
  const [targetFile, setTargetFile] = useState<{ name: string; content: string } | null>(null);
  const [pastedXml, setPastedXml] = useState('');
  const [targetLang, setTargetLang] = useState('ar');
  const [projectName, setProjectName] = useState('');
  // Shown after an import attempt with an empty name; the name becomes the exported zip's name.
  const [nameMissing, setNameMissing] = useState(false);
  // Once the user types a project name, picking a file no longer overwrites it.
  const projectNameTouched = useRef(false);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingReport, setPendingReport] = useState<{ result: RepairResult; fileName: string } | null>(null);
  // Phase 2 of issue #25: which fixable review issues (by id) the user has opted to apply. A fixable
  // issue defaults to NOT accepted — nothing with a possible meaning change is ever applied unless the
  // user explicitly chooses it.
  const [acceptedFixIds, setAcceptedFixIds] = useState<Set<string>>(new Set());
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);

  // Escape, while the Import Report is showing, steps back to the form instead of closing the whole
  // dialog — the report is a step inside the import flow, not a separate thing to dismiss outright.
  // The header's X button keeps closing the dialog outright either way.
  const dialogRef = useDialog(isOpen, () => {
    if (pendingReport) {
      setPendingReport(null);
      return;
    }
    onClose();
  });

  // The component stays mounted while closed, so without this a report left open (closed via X/Escape)
  // would reappear — with a stale file — the next time the dialog opens. Reset during render (not in an
  // effect) so react-hooks/set-state-in-effect stays happy.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setPendingReport(null);
      setAcceptedFixIds(new Set());
      setErrorMsg(null);
    }
  }

  // Focus follows the screen: when the report appears its Continue button takes focus (the "Start
  // translating" button that had focus unmounts), and going back via the Back button or Escape returns
  // focus to "Start translating". Without that second half the focused Continue button unmounts and
  // keyboard focus falls back to <body>.
  const hadReportRef = useRef(false);
  useEffect(() => {
    if (pendingReport) {
      hadReportRef.current = true;
      continueButtonRef.current?.focus();
    } else if (hadReportRef.current) {
      hadReportRef.current = false;
      startButtonRef.current?.focus();
    }
  }, [pendingReport]);

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
      // The file name (without .xml) becomes the project name, so exports can be named after it.
      // The generic strings.xml carries no project name, so the field stays empty for the user to fill.
      if (!projectNameTouched.current) setProjectName(suggestedProjectName(file.name));
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

  // Finishes the import from the result repairAndroidXml already parsed, so the file isn't parsed twice.
  const finalizeImport = (parsed: ParsedXmlResult, xmlToParse: string, fileName: string) => {
    const { items, errors, resourcesAttributes, indentStyle, itemIndentStyle } = parsed;
    if (errors.length > 0 || items.length === 0) {
      // The error box lives in the form view, not the report view — leave the report or the message is invisible.
      setPendingReport(null);
      setErrorMsg(
        errors.join('\n') ||
          (t('could_not_parse_any_strings'))
      );
      return;
    }

    let finalItems = normalizePluralsForLanguage(items, targetLang);

    // If an existing target translation file was also supplied, merge it!
    if (targetFile?.content) {
      // Same mechanical clean-up as the source file; otherwise a BOM or a bare "&" in the target file makes
      // it fail to parse and the merge silently matches nothing.
      const { updatedItems } = mergeTargetXml(finalItems, applySilentFixes(targetFile.content).text, targetLang);
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

  // A name arriving after the failed attempt (typed or auto-filled from a file) clears the error.
  const showNameMissing = nameMissing && !projectName.trim();

  const handleProcessImport = () => {
    setErrorMsg(null);
    setPendingReport(null);
    if (!projectName.trim()) {
      setNameMissing(true);
      projectNameInputRef.current?.focus();
      return;
    }
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

    // Phase 1 of issue #25: a pre-pass that silently fixes what's purely mechanical, flags
    // anything needing a human decision, and reports anything it can't safely import — instead
    // of today's all-or-nothing behavior, where one malformed tag fails the whole import.
    const sourceResult = repairAndroidXml(xmlToParse);
    // Issue #33 (4c): the optional translation file is only *reported on* (review tier, never excluded).
    const targetIssues = targetFile?.content && activeTab === 'upload' ? checkTargetFileIcu(targetFile.content) : [];
    const result: RepairResult =
      targetIssues.length > 0
        ? { ...sourceResult, reviewIssues: [...sourceResult.reviewIssues, ...targetIssues] }
        : sourceResult;

    // Phase 3: a parse error, or a file with nothing importable at all (possibly *because* every entry in
    // it turned out to be malformed/nameless — see result.blockingIssues in that case), still rejects the
    // whole import — there's nothing to show a report about. Otherwise, per-entry exclusions only: they
    // become a read-only section of the Import Report instead of blocking anything. Checked explicitly
    // (not inferred from "it parsed") so a future file-level blocking category can't slip through as one.
    const wholeFileRejected =
      result.parsed.errors.length > 0 ||
      result.parsed.items.length === 0 ||
      result.blockingIssues.some((i) => !isEntryExclusion(i));
    if (wholeFileRejected) {
      setErrorMsg(
        [t('import_report_blocking_header'), ...result.blockingIssues.map((i) => `• ${localizeRepairIssue(i, t)}`)].join('\n')
      );
      return;
    }

    // A BOM or a line-ending normalization is invisible in any text editor and can never be ambiguous —
    // reporting it on its own would just be noise, so only show the report when there's something else
    // (another kind of silent fix, anything needing a decision, or an excluded entry) worth telling the
    // user about.
    const silentFixesWorthReporting = result.silentFixes.some(
      (f) => f.category !== 'bom' && f.category !== 'line-endings'
    );
    if (silentFixesWorthReporting || result.reviewIssues.length > 0 || result.blockingIssues.some(isEntryExclusion)) {
      setAcceptedFixIds(new Set());
      setPendingReport({ result, fileName });
      return;
    }

    finalizeImport(result.parsed, result.fixedXml, fileName);
  };

  // Applies whichever suggested fixes the user accepted on the report screen, then finishes the import.
  const handleContinueFromReport = () => {
    if (!pendingReport) return;
    const { result, fileName } = pendingReport;
    const finalXml = applyReviewDecisions(result.fixedXml, result.reviewIssues, acceptedFixIds);
    // Nothing accepted (or nothing fixable) means finalXml is the exact same string — reuse the parse
    // already done in repairAndroidXml instead of parsing the file again.
    const parsed = finalXml === result.fixedXml ? result.parsed : parseAndroidXml(finalXml);
    finalizeImport(parsed, finalXml, fileName);
  };

  const setFixAccepted = (id: string, accepted: boolean) => {
    setAcceptedFixIds((prev) => {
      const next = new Set(prev);
      if (accepted) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const setAllFixesAccepted = (accepted: boolean) => {
    if (!pendingReport) return;
    if (!accepted) {
      setAcceptedFixIds(new Set());
      return;
    }
    setAcceptedFixIds(
      new Set(pendingReport.result.reviewIssues.filter(isFixableIssue).map((i) => i.id))
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      {/* Material 3 Dialog Container */}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ImportModal-title" tabIndex={-1} className="outline-none w-full max-w-xl bg-white dark:bg-[#1E1F20] rounded-3xl m3-elevation-3 border border-slate-200/80 dark:border-slate-800/80 overflow-hidden flex flex-col my-6 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
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
          {pendingReport ? (
            <ImportReportView
              report={pendingReport.result}
              t={t}
              acceptedFixIds={acceptedFixIds}
              onSetFixAccepted={setFixAccepted}
              onSetAllFixesAccepted={setAllFixesAccepted}
            />
          ) : (
            <>
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
                ref={projectNameInputRef}
                id="import-project-name"
                type="text"
                value={projectName}
                onChange={(e) => {
                  projectNameTouched.current = true;
                  setProjectName(e.target.value);
                  if (e.target.value.trim()) setNameMissing(false);
                }}
                placeholder={t('e_g_my_app_strings')}
                aria-invalid={showNameMissing}
                className={`w-full px-3.5 py-2 text-xs rounded-xl border bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none transition ${
                  showNameMissing
                    ? 'border-rose-400 dark:border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20'
                    : 'border-slate-200 dark:border-slate-700 focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/20'
                }`}
              />
              {showNameMissing ? (
                <p role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                  {t('project_name_required')}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  {t('project_name_export_hint')}
                </p>
              )}
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
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-6 pt-4 flex items-center gap-5">
          {pendingReport ? (
            <>
              <button onClick={() => setPendingReport(null)} className={FOOTER_SECONDARY_BTN}>
                {t('import_report_back')}
              </button>
              <button ref={continueButtonRef} onClick={handleContinueFromReport} className={`ms-auto ${FOOTER_PRIMARY_BTN}`}>
                {t('import_report_continue')}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className={FOOTER_SECONDARY_BTN}>
                {tb('cancel')}
              </button>
              <button
                onClick={() => {
                  onLoadSample();
                  onClose();
                }}
                className="py-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium cursor-pointer"
              >
                <span data-i18n>{t('load_sample_app')}</span>
              </button>
              <button ref={startButtonRef} onClick={handleProcessImport} className={`ms-auto ${FOOTER_PRIMARY_BTN}`}>
                {tb('start_translating')}
              </button>
            </>
          )}
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

// Phase 2 of issue #25: a review issue the user can act on — it has a `range` into `report.fixedXml` and a
// `suggestedFix` — gets a before/after preview and an explicit Keep-as-is / Escape-it choice, defaulting to
// Keep-as-is. A review issue with no safe fix to propose (today: duplicate-name) stays informational only,
// same as Phase 1 — there's nothing yet for the user to decide here beyond "go look at the source file".
function ReviewIssueRow({
  issue,
  report,
  t,
  accepted,
  onSetAccepted,
}: {
  issue: RepairIssue;
  report: RepairResult;
  t: Translate;
  accepted: boolean;
  onSetAccepted: (accepted: boolean) => void;
}) {
  const before = isFixableIssue(issue) ? report.fixedXml.slice(issue.range.start, issue.range.end) : null;
  const fixable = before !== null;
  const descriptionId = `${issue.id}-description`;

  return (
    <li className="text-xs text-slate-700 dark:text-slate-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-2.5 space-y-2">
      <div id={descriptionId}>{localizeRepairIssue(issue, t)}</div>

      {fixable && (
        <>
          {/* Ties the two toggle buttons to the issue they decide, so a screen reader doesn't just hear a bare,
              repeated "Keep as-is" / "Escape it" for every row. */}
          <div role="group" aria-labelledby={descriptionId} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSetAccepted(false)}
              aria-pressed={!accepted}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition cursor-pointer ${
                !accepted
                  ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
              }`}
            >
              {t('import_report_keep_original')}
            </button>
            <button
              type="button"
              onClick={() => onSetAccepted(true)}
              aria-pressed={accepted}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition cursor-pointer ${
                accepted
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white/70 dark:bg-black/20 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
              }`}
            >
              {t('import_report_escape_it')}
            </button>
          </div>
          {/* XML is always left-to-right: without dir="ltr" the Arabic (RTL) UI reorders the punctuation and
              backslashes and the preview no longer shows what will actually be written. min-w-0 lets a long
              unbroken value wrap inside the flex row instead of overflowing it; whitespace-pre-wrap keeps the
              value's real line breaks/indentation visible. */}
          <div className="space-y-1 text-[11px] font-mono">
            <div className="flex items-start gap-1.5">
              <span className="shrink-0 text-slate-400">{t('import_report_before')}</span>
              <span dir="ltr" className="min-w-0 whitespace-pre-wrap break-words text-rose-700 dark:text-rose-400">
                {before}
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="shrink-0 text-slate-400">{t('import_report_after')}</span>
              <span dir="ltr" className="min-w-0 whitespace-pre-wrap break-words text-emerald-700 dark:text-emerald-400">
                {issue.suggestedFix}
              </span>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

function ImportReportView({
  report,
  t,
  acceptedFixIds,
  onSetFixAccepted,
  onSetAllFixesAccepted,
}: {
  report: RepairResult;
  t: Translate;
  acceptedFixIds: Set<string>;
  onSetFixAccepted: (id: string, accepted: boolean) => void;
  onSetAllFixesAccepted: (accepted: boolean) => void;
}) {
  const fixableCount = report.reviewIssues.filter(isFixableIssue).length;

  return (
    <div className="pt-1 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('import_report_title')}</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{t('import_report_subtitle')}</p>
      </div>

      {report.silentFixes.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            {t('import_report_auto_fixed')}
          </div>
          <ul className="space-y-1">
            {report.silentFixes.map((issue) => (
              <li
                key={issue.id}
                className="text-xs text-slate-700 dark:text-slate-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl p-2.5"
              >
                {localizeRepairIssue(issue, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.reviewIssues.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              {t('import_report_needs_review')}
            </div>
            {fixableCount > 0 && (
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => onSetAllFixesAccepted(true)}
                  className="font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer"
                >
                  {t('import_report_apply_all')}
                </button>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <button
                  type="button"
                  onClick={() => onSetAllFixesAccepted(false)}
                  className="font-medium text-slate-500 dark:text-slate-400 hover:underline cursor-pointer"
                >
                  {t('import_report_keep_all')}
                </button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('import_report_review_note')}</p>
          <ul className="space-y-1.5">
            {report.reviewIssues.map((issue) => (
              <ReviewIssueRow
                key={issue.id}
                issue={issue}
                report={report}
                t={t}
                accepted={acceptedFixIds.has(issue.id)}
                onSetAccepted={(accepted) => onSetFixAccepted(issue.id, accepted)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Phase 3 of issue #25: a per-entry exclusion. Read-only — the entry is already out of fixedXml
          (repairAndroidXml only ever reports these once it has verified the rest of the file imports fine),
          so there's nothing left to accept or reject here; this section just tells the user what and why. */}
      {report.blockingIssues.some(isEntryExclusion) && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400">
            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
            {t('import_report_not_imported')}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('import_report_not_imported_note')}</p>
          <ul className="space-y-1">
            {report.blockingIssues.filter(isEntryExclusion).map((issue) => (
              <li
                key={issue.id}
                className="text-xs text-slate-700 dark:text-slate-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl p-2.5"
              >
                <p>{localizeRepairIssue(issue, t)}</p>
                {typeof issue.params?.excerpt === 'string' && issue.params.excerpt.trim() && (
                  <div className="mt-2 border-t border-rose-200/70 dark:border-rose-900/70 pt-2">
                    <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      {t('import_report_entry_excerpt')}
                    </p>
                    <pre dir="auto" className="mt-1 whitespace-pre-wrap break-words text-start font-mono text-[11px] leading-relaxed">
                      {issue.params.excerpt}
                    </pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
