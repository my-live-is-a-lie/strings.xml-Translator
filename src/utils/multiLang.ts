import { saveFile } from './saveFile';
import { ResourceItem, TranslationProject } from '../types';
import { normalizePluralsForLanguage } from './xmlParser';
import { generateAndroidXml, defaultExportOptions } from './xmlExporter';
import { getLanguageOption } from './languages';

/** Copy of the items with every translation cleared (source text only). */
export function blankItems(items: ResourceItem[]): ResourceItem[] {
  return items.map((item): ResourceItem => {
    if (item.type === 'string') {
      return { ...item, target: '', status: 'untranslated', translationSource: undefined, translationEngine: undefined };
    }
    if (item.type === 'plural') {
      return {
        ...item,
        items: item.items.map((q) => ({ ...q, target: '' })),
        status: 'untranslated',
        translationSource: undefined,
        translationEngine: undefined,
      };
    }
    return {
      ...item,
      items: item.items.map((e) => ({ ...e, target: '' })),
      status: 'untranslated',
      translationSource: undefined,
      translationEngine: undefined,
    };
  });
}

/** The items of `code` as they are now: the open language, a cached one, or a blank copy of the source. */
export function itemsForLanguage(project: TranslationProject, code: string): ResourceItem[] {
  if (project.targetLang.toLowerCase() === code.toLowerCase()) return project.items;
  const cached = project.translationsByLang?.[code];
  if (cached && cached.length === project.items.length) return normalizePluralsForLanguage(cached, code);
  return normalizePluralsForLanguage(blankItems(project.items), code);
}

/** True for strings that still need a translation and are allowed to be translated. */
export function needsTranslation(item: ResourceItem): boolean {
  if (item.translatable === false) return false;
  if (item.status === 'untranslated') return true;
  if (item.type === 'string') return !item.target.trim();
  return item.items.every((x) => !x.target.trim());
}

/** Android resource folder for a language, e.g. values-pt-rBR. */
export function valuesDirFor(code: string): string {
  return getLanguageOption(code).androidDir;
}

/** XML for one language. Untranslated strings are left out so Android falls back to the default values. */
export function xmlForLanguage(project: TranslationProject, items: ResourceItem[]): string {
  return generateAndroidXml(items, { ...defaultExportOptions, fallbackToSource: false }, project);
}

/** Packs files into a ZIP and starts the download. jszip is loaded on demand so it is not part of the main bundle. */
export async function downloadZip(files: Array<{ path: string; content: string }>, zipName: string): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.content);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  await saveFile(blob, zipName);
}
