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
  { value: 'gemini', nameEn: 'Gemini AI', nameAr: 'Gemini AI', labelAr: 'Gemini AI', labelEn: 'Gemini AI' },
  { value: 'lara', nameEn: 'Lara Translate', nameAr: 'Lara Translate', labelAr: 'Lara Translate', labelEn: 'Lara Translate' },
  { value: 'yandex', nameEn: 'Yandex AI', nameAr: 'Yandex AI', labelAr: 'Yandex AI', labelEn: 'Yandex AI' },
  { value: 'deepl', nameEn: 'DeepL API', nameAr: 'DeepL API', labelAr: 'DeepL API', labelEn: 'DeepL API' },
  { value: 'openai', nameEn: 'OpenAI GPT', nameAr: 'OpenAI GPT', labelAr: 'OpenAI GPT', labelEn: 'OpenAI GPT' },
  { value: 'google_cloud', nameEn: 'Google Cloud', nameAr: 'Google Cloud', labelAr: 'Google Cloud', labelEn: 'Google Cloud' },
  { value: 'libretranslate', nameEn: 'LibreTranslate', nameAr: 'LibreTranslate', labelAr: 'LibreTranslate', labelEn: 'LibreTranslate' },
  { value: 'microsoft', nameEn: 'Microsoft Azure Translator', nameAr: 'Microsoft Azure Translator', labelAr: 'Microsoft Azure Translator', labelEn: 'Microsoft Azure Translator' },
];

