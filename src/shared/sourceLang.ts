/** Source languages a project can have. Base ISO codes (no region), English first. */
export interface SourceLanguage {
  code: string;
  name: string;
  nameAr: string;
}

export const SOURCE_LANGUAGES: SourceLanguage[] = [
  { code: 'en', name: 'English', nameAr: 'الإنجليزية' },
  { code: 'ar', name: 'Arabic', nameAr: 'العربية' },
  { code: 'es', name: 'Spanish', nameAr: 'الإسبانية' },
  { code: 'fr', name: 'French', nameAr: 'الفرنسية' },
  { code: 'de', name: 'German', nameAr: 'الألمانية' },
  { code: 'pt', name: 'Portuguese', nameAr: 'البرتغالية' },
  { code: 'ja', name: 'Japanese', nameAr: 'اليابانية' },
  { code: 'zh', name: 'Chinese', nameAr: 'الصينية' },
  { code: 'it', name: 'Italian', nameAr: 'الإيطالية' },
  { code: 'ru', name: 'Russian', nameAr: 'الروسية' },
  { code: 'hi', name: 'Hindi', nameAr: 'الهندية' },
  { code: 'tr', name: 'Turkish', nameAr: 'التركية' },
  { code: 'pl', name: 'Polish', nameAr: 'البولندية' },
  { code: 'ko', name: 'Korean', nameAr: 'الكورية' },
  { code: 'nl', name: 'Dutch', nameAr: 'الهولندية' },
  { code: 'id', name: 'Indonesian', nameAr: 'الإندونيسية' },
  { code: 'vi', name: 'Vietnamese', nameAr: 'الفيتنامية' },
  { code: 'th', name: 'Thai', nameAr: 'التايلاندية' },
  { code: 'uk', name: 'Ukrainian', nameAr: 'الأوكرانية' },
  { code: 'fa', name: 'Persian', nameAr: 'الفارسية' },
  { code: 'he', name: 'Hebrew', nameAr: 'العبرية' },
  { code: 'ur', name: 'Urdu', nameAr: 'الأردية' },
  { code: 'sv', name: 'Swedish', nameAr: 'السويدية' },
  { code: 'el', name: 'Greek', nameAr: 'اليونانية' },
  { code: 'cs', name: 'Czech', nameAr: 'التشيكية' },
  { code: 'ro', name: 'Romanian', nameAr: 'الرومانية' },
  { code: 'hu', name: 'Hungarian', nameAr: 'المجرية' },
  { code: 'da', name: 'Danish', nameAr: 'الدنماركية' },
  { code: 'fi', name: 'Finnish', nameAr: 'الفنلندية' },
  { code: 'no', name: 'Norwegian', nameAr: 'النرويجية' },
  { code: 'ms', name: 'Malay', nameAr: 'الملايوية' },
];

/** Base code of a saved or detected language; anything unknown falls back to English. */
export function normalizeSourceLang(code?: string | null): string {
  const base = String(code || 'en').split(/[-_]/)[0].toLowerCase();
  return SOURCE_LANGUAGES.some((l) => l.code === base) ? base : 'en';
}

/** English name used inside provider prompts ("from Arabic to ..."). */
export function sourceLangName(code?: string | null): string {
  const base = normalizeSourceLang(code);
  return SOURCE_LANGUAGES.find((l) => l.code === base)?.name || 'English';
}

/** DeepL writes its source codes in upper case, with NB for Norwegian. */
export function deeplSourceCode(code?: string | null): string {
  const base = normalizeSourceLang(code);
  return base === 'no' ? 'NB' : base.toUpperCase();
}

/** Lara wants a region for Chinese. */
export function laraSourceCode(code?: string | null): string {
  const base = normalizeSourceLang(code);
  return base === 'zh' ? 'zh-CN' : base;
}
