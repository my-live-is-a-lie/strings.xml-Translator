import { describe, expect, it } from 'vitest';
import {
  deeplSourceCode,
  laraSourceCode,
  normalizeSourceLang,
  sourceLangLabel,
  sourceLangName,
  SOURCE_LANGUAGES,
} from '../src/shared/sourceLang';
import { collectSourceValues, detectSourceLanguage, usableDetectionText } from '../src/utils/sourceLanguage';
import type { ResourceItem } from '../src/types';

const str = (name: string, source: string): ResourceItem =>
  ({ id: name, name, type: 'string', source, target: '', status: 'untranslated' }) as unknown as ResourceItem;
const file = (values: string[]): ResourceItem[] => values.map((v, i) => str(`k${i}`, v));

const FILES: Record<string, string[]> = {
  en: ['Settings', 'Save changes', 'Cancel', 'Welcome back, %s', 'Delete this item?', 'No internet connection', 'OK', 'Search'],
  ar: ['الإعدادات', 'حفظ التغييرات', 'إلغاء', 'مرحبًا بعودتك، %s', 'حذف هذا العنصر؟', 'لا يوجد اتصال بالإنترنت', 'موافق', 'بحث'],
  es: ['Configuración', 'Guardar cambios', 'Cancelar', 'Bienvenido de nuevo, %s', '¿Eliminar este elemento?', 'Sin conexión a Internet', 'Aceptar', 'Buscar'],
  fr: ['Paramètres', 'Enregistrer les modifications', 'Annuler', 'Bon retour, %s', 'Supprimer cet élément ?', 'Pas de connexion Internet', 'Rechercher', 'Fermer'],
  de: ['Einstellungen', 'Änderungen speichern', 'Abbrechen', 'Willkommen zurück, %s', 'Dieses Element löschen?', 'Keine Internetverbindung', 'Suchen', 'Schließen'],
  ru: ['Настройки', 'Сохранить изменения', 'Отмена', 'С возвращением, %s', 'Удалить этот элемент?', 'Нет подключения к интернету', 'Поиск', 'Закрыть'],
  ja: ['設定', '変更を保存', 'キャンセル', 'おかえりなさい、%s', 'この項目を削除しますか？', 'インターネットに接続されていません', '検索', '閉じる'],
};

describe('normalizeSourceLang', () => {
  it('keeps supported base codes', () => {
    expect(normalizeSourceLang('es')).toBe('es');
    expect(normalizeSourceLang('AR')).toBe('ar');
  });
  it('strips a region or script suffix', () => {
    expect(normalizeSourceLang('pt-BR')).toBe('pt');
    expect(normalizeSourceLang('zh_CN')).toBe('zh');
  });
  it('falls back to English for empty, null and unknown codes', () => {
    expect(normalizeSourceLang(undefined)).toBe('en');
    expect(normalizeSourceLang(null)).toBe('en');
    expect(normalizeSourceLang('')).toBe('en');
    expect(normalizeSourceLang('xx')).toBe('en');
  });
  it('every listed language normalizes to itself and has both names', () => {
    for (const l of SOURCE_LANGUAGES) {
      expect(normalizeSourceLang(l.code)).toBe(l.code);
      expect(l.name).toBeTruthy();
      expect(l.nameAr).toBeTruthy();
    }
  });
});

describe('source language names and provider codes', () => {
  it('names follow the interface language', () => {
    expect(sourceLangLabel('es', false)).toBe('Spanish');
    expect(sourceLangLabel('es', true)).toBe('الإسبانية');
    expect(sourceLangName('zz')).toBe('English');
  });
  it('DeepL codes are upper case, with NB for Norwegian', () => {
    expect(deeplSourceCode('de')).toBe('DE');
    expect(deeplSourceCode('no')).toBe('NB');
  });
  it('Lara gets a region for Chinese only', () => {
    expect(laraSourceCode('zh')).toBe('zh-CN');
    expect(laraSourceCode('fr')).toBe('fr');
  });
});

describe('usableDetectionText', () => {
  it('removes format tokens, tags, urls, numbers and symbols', () => {
    expect(usableDetectionText(['Hello %1$s <b>world</b>', 'See https://example.com now', '{count} items 42'])).toEqual([
      'Hello world',
      'See now',
      'items',
    ]);
  });
  it('drops strings that are empty after cleaning', () => {
    expect(usableDetectionText(['%s', '123', '...', '@string/x_y', 'ok text'])).toEqual(['string x y', 'ok text']);
  });
});

describe('collectSourceValues', () => {
  it('reads strings, plural quantities and array elements', () => {
    const items = [
      str('a', 'One'),
      { id: 'p', name: 'p', type: 'plural', status: 'untranslated', items: [{ quantity: 'one', source: 'Two', target: '' }] },
      { id: 'r', name: 'r', type: 'array', status: 'untranslated', items: [{ index: 0, source: 'Three', target: '' }] },
    ] as unknown as ResourceItem[];
    expect(collectSourceValues(items)).toEqual(['One', 'Two', 'Three']);
  });
});

describe('detectSourceLanguage', () => {
  for (const [code, values] of Object.entries(FILES)) {
    it(`detects ${code} from a whole file`, async () => {
      const r = await detectSourceLanguage(file(values));
      expect(r.code).toBe(code);
      if (code !== 'en') expect(r.status).toBe('detected');
    });
  }
  it('keeps English as unsure when there are fewer than 5 usable strings', async () => {
    expect(await detectSourceLanguage(file(['Hola', 'Adiós', 'Gracias']))).toEqual({ code: 'en', status: 'unsure' });
  });
  it('keeps English as unsure for an empty file', async () => {
    expect(await detectSourceLanguage([])).toEqual({ code: 'en', status: 'unsure' });
  });
  it('ignores placeholders and tags: a file of only tokens is unsure', async () => {
    const r = await detectSourceLanguage(file(['%s', '%1$d', '<b></b>', '{x}', '12345', '...']));
    expect(r).toEqual({ code: 'en', status: 'unsure' });
  });
  it('always returns a supported code, whatever the text (known limit: Persian may read as Arabic)', async () => {
    const fa = ['تنظیمات', 'ذخیره تغییرات', 'لغو', 'خوش آمدید، %s', 'این مورد حذف شود؟', 'اتصال به اینترنت وجود ندارد', 'جستجو', 'بستن'];
    const r = await detectSourceLanguage(file(fa));
    expect(SOURCE_LANGUAGES.some((l) => l.code === r.code)).toBe(true);
  });
});
