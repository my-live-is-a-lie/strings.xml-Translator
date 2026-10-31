import { saveFile } from '../utils/saveFile';
import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ResourceItem } from '../types';
import { copyTextToClipboard } from '../utils/storage';
import { useDialog } from '../utils/useDialog';
import {
  Checked,
  IssueKind,
  applyTranslations,
  buildPrompt,
  buildSegments,
  buildTextRequest,
  checkReply,
  parseReply,
  requestJson,
  splitParts,
} from '../utils/externalAi';

interface Props {
  items: ResourceItem[];
  /** All strings of the file: the ones that need review can be added to the request on demand. */
  reviewPool?: ResourceItem[];
  targetLang: string;
  targetLocaleName?: string;
  appLang: 'ar' | 'en';
  onClose: () => void;
  onApply: (items: ResourceItem[]) => void;
}

function downloadText(name: string, text: string): void {
  void saveFile(new Blob([text], { type: 'application/json' }), name);
}

const ISSUE_LABELS: Record<IssueKind, { ar: string; en: string }> = {
  missing: { ar: 'لم تُترجم', en: 'Missing' },
  empty: { ar: 'فارغة', en: 'Empty' },
  placeholder: { ar: 'عناصر نائبة ناقصة', en: 'Placeholders/tags changed' },
  same: { ar: 'مطابقة للأصل', en: 'Same as source' },
};

/** Translate through any AI app by copy/paste or file, then validate and review before applying. */
export const ExternalAiModal: React.FC<Props> = ({ items: selectedItems, reviewPool, targetLang, targetLocaleName, appLang, onClose, onApply }) => {
  const isAr = appLang === 'ar';
  const dialogRef = useDialog<HTMLDivElement>(true, onClose);
  const label = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;

  const reviewExtra = useMemo(() => {
    const have = new Set(selectedItems.map((i) => i.id));
    return (reviewPool ?? []).filter((i) => i.status === 'needs_review' && !have.has(i.id));
  }, [reviewPool, selectedItems]);
  const [includeReview, setIncludeReview] = useState(false);
  const items = useMemo(() => (includeReview ? [...selectedItems, ...reviewExtra] : selectedItems), [includeReview, selectedItems, reviewExtra]);
  const segments = useMemo(() => buildSegments(items, targetLang), [items, targetLang]);
  const [partSize, setPartSize] = useState(0); // 0 = one file
  const parts = useMemo(() => splitParts(segments, partSize), [segments, partSize]);

  const [reply, setReply] = useState(() => new Map<number, string>());
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const say = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(''), 2000);
  };

  const absorb = (raw: string) => {
    try {
      const parsed = parseReply(raw);
      setReply((prev) => new Map([...prev, ...parsed]));
      setError('');
      setPasted('');
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(
        code === 'BAD_JSON'
          ? isAr ? 'الرد ليس JSON صالحاً (ربما قُطع في المنتصف). اطلب من الذكاء الاصطناعي إكماله.' : 'The reply is not valid JSON (it may have been cut off). Ask the AI to continue.'
          : isAr ? 'لم أجد ترجمات في هذا النص.' : 'No translations found in this text.'
      );
    }
  };

  const checked = useMemo(() => checkReply(segments, reply), [segments, reply]);
  const rows: Checked[] = checked.rows.map((r) => {
    const text = edited[r.segment.id];
    if (text === undefined) return r;
    return checkReply([r.segment], new Map(text ? [[r.segment.id, text]] : []))
      .rows[0];
  });
  const problems = rows.filter((r) => r.issues.length > 0);
  const answered = rows.filter((r) => !r.issues.includes('missing')).length;
  const accepted = rows.filter((r) => r.text.trim() && !excluded.has(r.segment.id));

  const copy = async (text: string, msg: string) => {
    await copyTextToClipboard(text);
    say(msg);
  };

  const missingRequest = () => {
    const redo = problems.map((r) => r.segment);
    const prompt = buildPrompt(label, 'text');
    return buildTextRequest(prompt, requestJson(redo, label));
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-ai-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#1E1F20] border border-slate-200 dark:border-slate-700 shadow-xl p-4 space-y-4 text-sm text-slate-800 dark:text-slate-100"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="external-ai-title" className="font-semibold">
            {isAr ? `الترجمة عبر تطبيق ذكاء اصطناعي (${segments.length} نص → ${label})` : `Translate with an AI app (${segments.length} strings → ${label})`}
          </h2>
          <button type="button" onClick={onClose} className="px-2 text-slate-500 cursor-pointer" aria-label={isAr ? 'إغلاق' : 'Close'}>✕</button>
        </div>

        <p className="text-xs text-amber-700 dark:text-amber-300">
          {isAr ? 'تنبيه: نصوص التطبيق ستُرسل إلى خدمة الذكاء الاصطناعي التي تختارها. لا تُرسل مفاتيح API.' : 'Note: the strings will be sent to the AI service you choose. No API keys are included.'}
        </p>

        {/* Step 1 */}
        <section className="space-y-2" aria-labelledby="ext-step1">
          <h3 id="ext-step1" className="font-semibold">{isAr ? '١) جهّز الطلب وأرسله' : '1) Prepare and send the request'}</h3>
          {reviewExtra.length > 0 && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                id="ext-include-review"
                checked={includeReview}
                onChange={(e) => {
                  // The numbering changes with the request, so an earlier reply no longer matches
                  setIncludeReview(e.target.checked);
                  setReply(new Map());
                  setEdited({});
                  setExcluded(new Set());
                  setError('');
                }}
              />
              <span>
                {isAr
                  ? `إضافة النصوص التي تحتاج مراجعة (${reviewExtra.length}) إلى الطلب`
                  : `Also include strings that need review (${reviewExtra.length})`}
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 text-xs">
            <span>{isAr ? 'التقسيم:' : 'Split:'}</span>
            <select
              id="ext-part-size"
              value={partSize}
              onChange={(e) => setPartSize(Number(e.target.value))}
              className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#1E1F20]"
            >
              <option value={0}>{isAr ? 'ملف واحد' : 'One file'}</option>
              <option value={150}>{isAr ? 'أجزاء من 150 نصاً' : 'Parts of 150'}</option>
              <option value={80}>{isAr ? 'أجزاء من 80 نصاً' : 'Parts of 80'}</option>
            </select>
          </label>
          <ul className="space-y-1.5">
            {parts.map((part, i) => {
              const json = requestJson(part, label);
              const suffix = parts.length > 1 ? `-part${i + 1}` : '';
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
                  <span className="text-xs flex-1 min-w-24">
                    {parts.length > 1 ? (isAr ? `جزء ${i + 1} من ${parts.length}` : `Part ${i + 1} of ${parts.length}`) : isAr ? 'كل النصوص' : 'All strings'} · {part.length}
                  </span>
                  <button type="button" data-ext="copy-text" className="btn-ext" onClick={() => copy(buildTextRequest(buildPrompt(label, 'text'), json), isAr ? 'تم نسخ الطلب' : 'Request copied')}>
                    {isAr ? 'نسخ كنص' : 'Copy as text'}
                  </button>
                  <button type="button" data-ext="download" className="btn-ext" onClick={() => downloadText(`strings-to-translate${suffix}.json`, json)}>
                    {isAr ? 'تنزيل ملف' : 'Download file'}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" data-ext="copy-prompt" className="btn-ext" onClick={() => copy(buildPrompt(label, 'file'), isAr ? 'تم نسخ الموجّه' : 'Prompt copied')}>
            {isAr ? 'نسخ الموجّه فقط (للإرسال مع الملف)' : 'Copy the prompt only (to send with the file)'}
          </button>
        </section>

        {/* Step 2 */}
        <section className="space-y-2" aria-labelledby="ext-step2">
          <h3 id="ext-step2" className="font-semibold">{isAr ? '٢) الصق الرد أو ارفع ملفه' : '2) Paste the reply or upload its file'}</h3>
          <textarea
            id="ext-reply"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            placeholder={isAr ? 'الصق رد الذكاء الاصطناعي هنا…' : 'Paste the AI reply here…'}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#151922] p-2 text-xs font-mono"
            dir="auto"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" id="ext-check" className="btn-ext" disabled={!pasted.trim()} onClick={() => absorb(pasted)}>
              {isAr ? 'تحقق من الرد' : 'Check the reply'}
            </button>
            <button type="button" className="btn-ext" onClick={() => fileRef.current?.click()}>
              {isAr ? 'رفع ملف الرد' : 'Upload reply file'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.txt,application/json,text/plain"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) absorb(await f.text());
                e.target.value = '';
              }}
            />
          </div>
          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          {reply.size > 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-300" aria-live="polite" data-ext="summary">
              {isAr
                ? `${answered} من ${segments.length} مترجمة · ${problems.length} فيها مشاكل`
                : `${answered} of ${segments.length} answered · ${problems.length} with problems`}
              {checked.unknownIds.length > 0 && (isAr ? ` · ${checked.unknownIds.length} أرقام غير معروفة تم تجاهلها` : ` · ${checked.unknownIds.length} unknown ids ignored`)}
            </p>
          )}
        </section>

        {/* Step 3 */}
        {reply.size > 0 && (
          <section className="space-y-2" aria-labelledby="ext-step3">
            <h3 id="ext-step3" className="font-semibold">{isAr ? '٣) راجع ثم اعتمد' : '3) Review, then apply'}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                {isAr ? 'عرض المشاكل فقط' : 'Show problems only'}
              </label>
              {problems.length > 0 && (
                <button type="button" className="btn-ext" onClick={() => copy(missingRequest(), isAr ? 'تم نسخ طلب النصوص الناقصة' : 'Request for the missing strings copied')}>
                  {isAr ? 'نسخ طلب للنصوص الناقصة/الخاطئة فقط' : 'Copy a request for the missing/wrong ones'}
                </button>
              )}
            </div>
            <ul className="space-y-2 max-h-80 overflow-y-auto" data-ext="review-list">
              {rows
                .filter((r) => !onlyProblems || r.issues.length > 0)
                .map((r) => {
                  const on = !excluded.has(r.segment.id);
                  return (
                    <li key={r.segment.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-2 space-y-1">
                      <div className="flex items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={on && !!r.text.trim()}
                          disabled={!r.text.trim()}
                          aria-label={isAr ? `اعتماد ${r.segment.key}` : `Accept ${r.segment.key}`}
                          onChange={() =>
                            setExcluded((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.segment.id)) next.delete(r.segment.id);
                              else next.add(r.segment.id);
                              return next;
                            })
                          }
                        />
                        <span className="font-mono truncate flex-1" dir="ltr">{r.segment.key}</span>
                        {r.issues.map((k) => (
                          <span key={k} className="px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                            {isAr ? ISSUE_LABELS[k].ar : ISSUE_LABELS[k].en}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 break-words" dir="auto">{r.segment.text}</p>
                      <textarea
                        value={edited[r.segment.id] ?? r.text}
                        onChange={(e) => setEdited((prev) => ({ ...prev, [r.segment.id]: e.target.value }))}
                        rows={2}
                        dir="auto"
                        aria-label={isAr ? `الترجمة: ${r.segment.key}` : `Translation: ${r.segment.key}`}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#151922] p-1.5 text-xs"
                      />
                    </li>
                  );
                })}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-emerald-600 dark:text-emerald-400" aria-live="polite">{notice}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ext">{isAr ? 'إلغاء' : 'Cancel'}</button>
            <button
              type="button"
              id="ext-apply"
              disabled={accepted.length === 0}
              onClick={() => {
                onApply(applyTranslations(items, targetLang, accepted));
                onClose();
              }}
              className="px-4 py-1.5 rounded-full text-sm font-medium bg-[#1EB996] text-white cursor-pointer disabled:opacity-50"
            >
              {isAr ? `اعتماد ${accepted.length}` : `Apply ${accepted.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
