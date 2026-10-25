export type AppLanguage = 'ar' | 'en';

/** Languages whose UI should be laid out right-to-left. */
export const isRtlAppLanguage = (lang: string): boolean => lang === 'ar';

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

/** True when the document is currently laid out right-to-left (safe outside the browser). */
export const isDocumentRtl = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

/**
 * +1 in LTR, -1 in RTL. Multiply a horizontal touch delta by this to get a delta measured
 * towards the "end" side of the layout.
 */
export const inlineSign = (): 1 | -1 => (isDocumentRtl() ? -1 : 1);
