# PROJECT_CONTEXT — strings.xml Translator

Owner: Osama (Arabic-speaking developer; talks in Arabic). Repo: `my-live-is-a-lie/strings.xml-Translator`, branch `main`.

## What it is
Web app (also packaged as a Capacitor Android app) for translating Android `strings.xml` files. UI is bilingual (Arabic RTL / English LTR) and now supports user-added languages.

## Stack
React + TypeScript + Vite + Tailwind (logical utilities, `rtl:` variants), Capacitor, vitest (67 tests), ESLint with React Compiler rules (`react-hooks/refs`, `immutability`, `set-state-in-effect`), Playwright for manual browser checks.

## Key conventions
- Direction: `document.documentElement.dir` via `applyAppDirection(appLang)`; `inlineSign()` = +1 LTR / -1 RTL. Prefer logical utilities (`ms-*`, `ps-*`, `text-start`).
- `appLang: 'ar' | 'en'` is the LAYOUT language passed to components (`isAr = appLang === 'ar'`). In `App.tsx`, `uiLang` (string code) is the real chosen language; custom RTL languages map to `appLang='ar'`, custom LTR to `'en'`.
- Storage: `getStoredItem/setStoredItem` (`src/utils/storage.ts`); only `app_*` keys reach localStorage. Language: `app_ui_language`; custom languages: `app_custom_languages`.
- i18n (`src/i18n/`):
  - `uiStrings.ts` GENERATED registry `{key: {en, ar}}` (~370 keys, positional placeholders `%1$s`); `modalStrings.ts` hand-written keys for the add-language window; `allStrings.ts` merges both.
  - `i18n.ts`: custom-language store, `setActiveLanguage`, `tg/tgb` (non-React), `useT()` -> `{t, tb}`. `tb` = text-only buttons (empty value -> English). Missing key -> English.
  - `stringsXml.ts`: `generateEnglishUiXml()` / tolerant `parseUiXml()`.
  - Elements showing `t()` text carry `data-i18n`; CSS in `src/index.css`: `[data-i18n]:empty{display:none}` plus clipping.
  - `src/components/AddLanguageModal.tsx`: instructions, download English file, name, RTL/LTR, upload, manage/delete.
- Inline `isAr ? 'ar text' : 'en text'` ternaries were codemodded to `t('key')`. New UI text should be added as a key (not a ternary).

## Other recent features (all on main)
Table view: collapsing header + windowed lazy loading, length-sort button; strings-list drawer redesign (search icon, merged summary card, sticky collapsing header); settings drawer re-opens on the language's side on language change; long-press-drag width trading between editor action buttons (`useResizablePair`, `EditorActionButtons`).

## Workflow notes
- Commit trailer required: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the `Claude-Session:` line.
- Don't `pkill -f "vite preview"` inside a command (kills the shell); start preview with `nohup ... &`. Playwright: run scripts with `NODE_PATH=$(npm root -g):<repo>/node_modules`.
- Remote branch deletion via `git push --delete` fails in the sandbox; ask the user to delete on GitHub (`table-scroll-header` is still pending).
