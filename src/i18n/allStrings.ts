import { UI_STRINGS } from './uiStrings';
import { MODAL_STRINGS } from './modalStrings';
import { FONT_STRINGS } from './fontStrings';

export const ALL_STRINGS: Record<string, { en: string; ar: string }> = { ...UI_STRINGS, ...MODAL_STRINGS, ...FONT_STRINGS };
