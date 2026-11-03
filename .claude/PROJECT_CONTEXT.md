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

---

# Landscape / editor session (separate Claude session, 2026-11-03)


Owner: Osama (Arabic speaker; replies and UI copy in Arabic). Repo: https://github.com/my-live-is-a-lie/strings.xml-Translator (branch `main`). Working copy used so far: `/home/claude/strings.xml-translator`.

### What it is
A web/PWA + Android (Capacitor 8) app to translate Android `strings.xml` files. Stack: React 19, TypeScript, Vite, Tailwind, vitest (65 unit tests), Playwright e2e (runs in CI only), eslint with react-hooks compiler rules.

### Commands
- `npm run lint` (tsc --noEmit + eslint) — must pass; no ref writes during render, no setState inside effects.
- `npm test` (vitest), `npm run build`, `npm run dev` (tsx server.ts; for quick visual checks use `npx vite --port 5199`).
- Visual checks: Playwright + Chromium (`require('playwright')`), landscape viewport ~780x360.

### CI / release
- `build.yml`: lint, unit tests, e2e on every push.
- `release.yml`: signed APK via `workflow_dispatch` ("Run workflow"). "Re-run" reuses the OLD commit, so after any fix start a fresh run. The Android project is generated in CI (`npx cap add android`), so new Capacitor plugins need a fresh release build.
- Git/GitHub: `gh` works for runs; log downloads are forbidden. Pushing needed `add_repo` with access "push".
- Commit trailer to use: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01PmkDA6nP8tCXCSgGb2dZLh`.

### Key code map
- `src/components/TranslationEditor.tsx` — editor; `slot(key, className, children, plainClass?)` renders regions either inline or, in landscape split, via `createPortal` into the writing half (`bottomPortal`). Regions: r0 language label row, r1 textareas, r2 action buttons, r3 nav footer. Portal slots get `shrink-0`. Classes `kb-hide`, `kb-card`, `kb-src`, `kb-tools`, `kb-r1`, `kb-r2` are hooks for keyboard-open CSS.
- `src/App.tsx` — layout; `renderHeader(part)` with parts `all | bar | stats | legend | track | dock`; `splitActive = landscape && activeView === 'editor'`; `stringsDrawerNode`; root gets `kb-open` when landscape and a text field is focused.
- `src/components/Header.tsx` — top bar, progress track/legend, landscape `dock` (bottom bar), right drawer (sidebar) with `drawerSide` + edge-swipe opening.
- `src/components/OfflineDot.tsx` — green/red dot, expands 3 s on tap; connectivity verified by `fetch` to `https://translate.googleapis.com/generate_204` (CSP allows only that kind of host; do not use gstatic).
- `src/components/SplitDivider.tsx`, `src/hooks/useLandscapeSplit.ts` — landscape detection (`innerWidth > innerHeight && innerHeight <= 540`), status-bar hiding via Capacitor core SystemBars (`insetsHandling: 'css'`), split ratio 0.35–0.65 + swap (persisted), `useTextFieldFocused`.
- `src/components/StringsListDrawer.tsx` — strings list drawer (`always` prop shows it on wide/landscape screens).
- `src/components/QuickFilters.tsx`, `src/utils/quickFilters.ts` — filter chips/state (`open` toggles the chip bar).
- `src/utils/saveFile.ts` — saving files: browser link download, or on Android cache file + share sheet (`@capacitor/filesystem`, `@capacitor/share`). Used by `multiLang.ts` (ZIP), `xmlExporter.ts`, `ExternalAiModal.tsx`.
- Editing aids: `src/utils/endPunctuation.ts`, `syntaxFix.ts`, `autoCloseBracket.ts`, `wordPredictor.ts`, `src/hooks/usePredictiveWords.ts`, `autoCorrectSetting.ts`.
- `index.css` — `.kb-open` rules that tighten the editor and hide `.kb-hide` while typing in landscape.

### Behaviour decisions made with the user
- Save enforces the source's final punctuation/spacing; first press blocks and auto-corrects with a message, second press saves. Smart repair of placeholders, HTML tags and brackets; double space closes the nearest unclosed bracket. Auto-correct and word prediction each have sidebar toggles (auto-correct default on).
- Word prediction: machine translation fetched only when the user starts typing; whole space-separated tokens (incl. punctuation, placeholders, tags); Space accepts, Backspace rejects and offers next; no trailing space after one-word source or last stored word.
- Nothing typed → nothing saved; Save & Continue just moves on; plain Save says "لم يُحفظ شيء".
- Landscape phone: status bar hidden only in landscape; two halves (info = source text and shortcut bars; writing = textarea and buttons); divider drag ±15%, tap swaps and resets to equal halves; handle at the divider's top.
- Landscape dock (single bottom bar, full width): right group Files, Filters, Strings list; left group offline dot, Table, sidebar button. Thin progress line under it. Stats legend (one line) sits at bottom of info half and is replaced by filter chips while filters are open.
- While a text field is focused in landscape: dock, track, legend and the two label rows are hidden; boxes/buttons tightened.
- Edge swipe (28 px from either edge) opens the panel whose button is nearer that edge (strings list vs sidebar); sidebar slides from the swiped side.

### Gotchas
- Android WebView can't download `blob:` links — always use `saveFile`.
- `navigator.onLine` is unreliable in WebView — use the probe in `OfflineDot`.
- `StringsListDrawer` was `md:hidden`; landscape phones are >768px wide.
- Flex children with `overflow-hidden` collapse in a scrolling flex column unless `shrink-0`.
- Headless sandbox cannot reach external hosts; the dot shows red there.
