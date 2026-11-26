// Static option lists for the header and provider settings.
import type { AppTheme } from '../utils/theme';

export const APP_LANGUAGES = [
  { code: 'ar' as const, label: 'العربية' },
  { code: 'en' as const, label: 'English' },
];

export type { AppTheme };

export const THEME_OPTIONS: Array<{ id: AppTheme; label: string; labelAr: string }> = [
  { id: 'day', label: 'Day', labelAr: 'نهار' },
  { id: 'night', label: 'Night', labelAr: 'ليل' },
  { id: 'black_hole', label: 'Black Hole', labelAr: 'ثقب أسود' },
];

export const ENGINE_OPTIONS: Array<{ value: string; nameEn: string; nameAr: string; labelAr: string; labelEn: string }> = [
  { value: 'auto', nameEn: '', nameAr: '', labelAr: 'تعرف تلقائي على المزود', labelEn: 'Auto-Detect Provider' },
  { value: 'gemini', nameEn: 'Gemini AI', nameAr: 'ذكاء Gemini الاصطناعي', labelAr: 'Gemini', labelEn: 'Gemini' },
  { value: 'lara', nameEn: 'Lara Translate', nameAr: 'ترجمة Lara الذكية', labelAr: 'Lara', labelEn: 'Lara' },
  { value: 'yandex', nameEn: 'Yandex AI', nameAr: 'ترجمة Yandex الذكية', labelAr: 'Yandex', labelEn: 'Yandex' },
  { value: 'deepl', nameEn: 'DeepL API', nameAr: 'ترجمة DeepL', labelAr: 'DeepL', labelEn: 'DeepL' },
  { value: 'openai', nameEn: 'OpenAI GPT', nameAr: 'ذكاء OpenAI GPT', labelAr: 'OpenAI', labelEn: 'OpenAI' },
  { value: 'google_cloud', nameEn: 'Google Cloud Translate', nameAr: 'ترجمة Google السحابية', labelAr: 'Google Cloud', labelEn: 'Google Cloud' },
  { value: 'libretranslate', nameEn: 'LibreTranslate', nameAr: 'ليبرترانسليت (مفتوح المصدر)', labelAr: 'LibreTranslate', labelEn: 'LibreTranslate' },
  { value: 'microsoft', nameEn: 'Microsoft Translator', nameAr: 'مترجم Microsoft', labelAr: 'Microsoft Translator', labelEn: 'Microsoft Translator' },
];

