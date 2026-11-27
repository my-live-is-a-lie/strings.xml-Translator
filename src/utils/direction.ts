import { isRtlLanguageCode } from '../i18n/i18n';
export type AppLanguage = 'ar' | 'en';

/** Languages whose UI should be laid out right-to-left. */
export const isRtlAppLanguage = (lang: string): boolean => isRtlLanguageCode(lang);

/**
 * Applies the reading direction (and `lang`) of the chosen interface language to the whole
 * document. Tailwind's logical utilities (`ms-*`, `ps-*`, `text-start`, `border-s`, …) and the
 * `rtl:` variant react to this attribute, so the entire layout mirrors from one place.
 */
export const applyAppDirection = (lang: string): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dir = isRtlAppLanguage(lang) ? 'rtl' : 'ltr';
  if (root.getAttribute('dir') !== dir) root.setAttribute('dir', dir);
  if (root.getAttribute('lang') !== lang) root.setAttribute('lang', lang);
};

// Strong RTL (Hebrew/Arabic script blocks) and strong LTR (Latin) character ranges, used to
// detect the reading direction of free text typed by the user.
const STRONG_RTL_CHAR = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
const STRONG_LTR_CHAR = /[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02B8\u1E00-\u1EFF]/;

/**
 * Direction of free text from its first strong character (Unicode first-strong rule), the
 * same rule the browser applies for `dir="auto"`. Returns undefined when the text has no
 * strong character yet (empty, or only digits/punctuation/neutrals), so callers can fall
 * back to the page direction. Use for user-typed fields whose content language can differ
 * from the UI language, e.g. an English provider name typed in the Arabic interface.
 */
export const textDirection = (text: string): 'rtl' | 'ltr' | undefined => {
  for (const ch of text) {
    if (STRONG_RTL_CHAR.test(ch)) return 'rtl';
    if (STRONG_LTR_CHAR.test(ch)) return 'ltr';
  }
  return undefined;
};

/** True when the document is currently laid out right-to-left (safe outside the browser). */
export const isDocumentRtl = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

/**
 * +1 in LTR, -1 in RTL. Multiply a horizontal touch delta by this to get a delta measured
 * towards the "end" side of the layout.
 */
export const inlineSign = (): 1 | -1 => (isDocumentRtl() ? -1 : 1);
