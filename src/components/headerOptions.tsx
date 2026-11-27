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
  { value: 'gemini', nameEn: 'Gemini API', nameAr: 'Gemini API', labelAr: 'Gemini API', labelEn: 'Gemini API' },
  { value: 'lara', nameEn: 'Lara Translate', nameAr: 'Lara Translate', labelAr: 'Lara Translate', labelEn: 'Lara Translate' },
  { value: 'yandex', nameEn: 'Yandex Cloud Translate', nameAr: 'Yandex Cloud Translate', labelAr: 'Yandex Cloud Translate', labelEn: 'Yandex Cloud Translate' },
  { value: 'deepl', nameEn: 'DeepL API', nameAr: 'DeepL API', labelAr: 'DeepL API', labelEn: 'DeepL API' },
  { value: 'openai', nameEn: 'OpenAI API', nameAr: 'OpenAI API', labelAr: 'OpenAI API', labelEn: 'OpenAI API' },
  { value: 'google_cloud', nameEn: 'Google Cloud', nameAr: 'Google Cloud', labelAr: 'Google Cloud', labelEn: 'Google Cloud' },
  { value: 'libretranslate', nameEn: 'LibreTranslate', nameAr: 'LibreTranslate', labelAr: 'LibreTranslate', labelEn: 'LibreTranslate' },
  { value: 'microsoft', nameEn: 'Microsoft Azure Translator', nameAr: 'Microsoft Azure Translator', labelAr: 'Microsoft Azure Translator', labelEn: 'Microsoft Azure Translator' },
];

