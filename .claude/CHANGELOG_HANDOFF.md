# CHANGELOG_HANDOFF

Newest first. Main commit hashes where known.

## 2026-11-02 — User-provided app languages (`3c30387`)
- New `src/i18n/*`, `AddLanguageModal.tsx`; ~440 inline bilingual ternaries converted to `t()/tb()/tg()` by a TypeScript-API codemod (lived in scratch space, not in repo); `Header.tsx` language strip + "+" button; `App.tsx` `uiLang` state with derived `appLang`; `direction.ts` uses `isRtlLanguageCode`; CSS for `[data-i18n]`.
- Unused `isAr`/`appLang` props left over by the codemod were removed or renamed `_appLang`.
- Tests: `src/i18n/stringsXml.test.ts` added.

## Earlier (all on main, latest before this `19ae740`)
- Resizable editor action buttons by long-press drag (incl. icon buttons).
- Settings drawer re-opens on the correct side when the language changes.
- Strings-list drawer redesign: header search, merged collapsible summary, sticky collapsing header, native scroll, search keeps focus with keyboard.
- Table view: collapsing top block, windowed lazy loading, length sort button with animated icon, sticky edited rows under filters.
