export interface LanguageOption {
  code: string; // Android locale code (e.g., 'es', 'pt-rBR', 'zh-rCN')
  name: string; // English name (e.g., 'Spanish', 'Portuguese (Brazil)')
  nativeName: string; // Native name (e.g., 'Español', 'Português (Brasil)')
  androidDir: string; // e.g. 'values-es'
  isRtl?: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', androidDir: 'values-ar', isRtl: true },
  { code: 'es', name: 'Spanish', nativeName: 'Español', androidDir: 'values-es' },
  { code: 'fr', name: 'French', nativeName: 'Français', androidDir: 'values-fr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', androidDir: 'values-de' },
  { code: 'pt-rBR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', androidDir: 'values-pt-rBR' },
  { code: 'pt', name: 'Portuguese (Portugal)', nativeName: 'Português', androidDir: 'values-pt' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', androidDir: 'values-ja' },
  { code: 'zh-rCN', name: 'Chinese (Simplified)', nativeName: '简体中文', androidDir: 'values-zh-rCN' },
  { code: 'zh-rTW', name: 'Chinese (Traditional)', nativeName: '繁體中文', androidDir: 'values-zh-rTW' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', androidDir: 'values-it' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', androidDir: 'values-ru' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', androidDir: 'values-hi' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', androidDir: 'values-tr' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', androidDir: 'values-pl' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', androidDir: 'values-ko' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', androidDir: 'values-nl' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', androidDir: 'values-id' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', androidDir: 'values-vi' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', androidDir: 'values-th' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', androidDir: 'values-uk' },
  { code: 'fa', name: 'Persian (Farsi)', nativeName: 'فارسی', androidDir: 'values-fa', isRtl: true },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', androidDir: 'values-he', isRtl: true },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', androidDir: 'values-ur', isRtl: true },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', androidDir: 'values-sv' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', androidDir: 'values-el' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', androidDir: 'values-cs' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', androidDir: 'values-ro' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', androidDir: 'values-hu' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', androidDir: 'values-da' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', androidDir: 'values-fi' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', androidDir: 'values-no' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', androidDir: 'values-ms' },
];

export const ARABIC_LANGUAGE_NAMES: Record<string, string> = {
  ar: 'العربية',
  es: 'الإسبانية',
  fr: 'الفرنسية',
  de: 'الألمانية',
  'pt-rbr': 'البرتغالية (البرازيل)',
  pt: 'البرتغالية',
  ja: 'اليابانية',
  'zh-rcn': 'الصينية (المبسطة)',
  'zh-rtw': 'الصينية (التقليدية)',
  it: 'الإيطالية',
  ru: 'الروسية',
  hi: 'الهندية',
  tr: 'التركية',
  pl: 'البولندية',
  ko: 'الكورية',
  nl: 'الهولندية',
  id: 'الإندونيسية',
  vi: 'الفيتنامية',
  th: 'التايلاندية',
  uk: 'الأوكرانية',
  fa: 'الفارسية',
  he: 'العبرية',
  ur: 'الأردية',
  sv: 'السويدية',
  el: 'اليونانية',
  cs: 'التشيكية',
  ro: 'الرومانية',
  hu: 'المجرية',
  da: 'الدنماركية',
  fi: 'الفنلندية',
  no: 'النرويجية',
  ms: 'الملايوية',
  en: 'الإنجليزية',
};

export function getArabicLanguageName(code: string, fallbackName?: string): string {
  const normalized = (code || 'ar').toLowerCase();
  if (ARABIC_LANGUAGE_NAMES[normalized]) {
    return ARABIC_LANGUAGE_NAMES[normalized];
  }
  const base = normalized.split('-')[0];
  if (ARABIC_LANGUAGE_NAMES[base]) {
    return ARABIC_LANGUAGE_NAMES[base];
  }
  if (fallbackName && fallbackName.toLowerCase() === 'arabic') {
    return 'العربية';
  }
  return fallbackName || 'العربية';
}

export function getLanguageOption(code: string): LanguageOption {
  const found = SUPPORTED_LANGUAGES.find(
    (l) => l.code.toLowerCase() === code.toLowerCase()
  );
  if (found) return found;

  return {
    code,
    name: code,
    nativeName: getArabicLanguageName(code, code),
    androidDir: `values-${code}`,
    isRtl: ['ar', 'fa', 'he', 'ur'].includes(code.toLowerCase()),
  };
}
