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

---

# Landscape / editor session (separate Claude session, 2026-11-03)


Commits are on `main`; short hashes where known.

### Strings list / editor basics
- Filter chips no longer clipped (`flex-wrap`); removed AI/Manual text labels (kept icons/numbers) and the red progress bar in the list.
- Save-time checks: final punctuation (`.`, `…`, `!`, `?`), spacing before it, no trailing spaces; first save blocked + auto-corrected + message, second saves (`endPunctuation.ts`).
- Smart syntax repair (placeholders incl. partial like `%1$`, HTML tags, unclosed brackets) in `syntaxFix.ts`; double space auto-closes nearest bracket (`autoCloseBracket.ts`).
- Fixes: double placeholder `%1$ %1$s`, stray trailing space after inserted placeholder, trailing space before final mark when source has none.
- Sidebar toggles: word prediction and auto-correct (`predictive_words_v1`, `autoCorrectSetting.ts`).
- Word prediction (`wordPredictor.ts`, `usePredictiveWords.ts`): lazy MT fetch, grey completion, Space accepts / Backspace rejects, whole tokens incl. punctuation/placeholders/tags, no re-suggesting used words, next-word suggestion, no trailing space after one-word source or last stored word.
- Nothing typed → not saved; Save & Continue moves on (`8d4f235`, `21bc94b`).
- CI lint failures fixed (`5427a51`); release needed a fresh workflow_dispatch.

### Landscape phone mode
- `f369fa7`: split into two halves with draggable divider (±15%), tap swaps; status bar hidden in landscape only.
- `cf3ae53`: status bar overlap fix (core SystemBars + safe-area padding; removed @capacitor/status-bar); more robust landscape detection.
- `67d5dc4`…`f495d08`: shared bar across both halves, moved to bottom; progress/list/filter moved bottom; swap handle moved to the top of divider.
- `94b30a5`: progress + list/filter into info half; compact action buttons (`EditorActionButtons compact`).
- `9877515`: bottom **dock** (Header `part='dock'`), `OfflineDot`, filters replace stats (`legend`/`track` parts).
- `3b062f5`: language label row moved to writing half (`slot('r0')`); one-line compact stats.
- `5f77460`: offline dot verified with real request; red + "غير متصل بالإنترنت" when offline.
- `e387e57`: dock grouped left/right; swap handle ~30% smaller; swap resets to equal halves; split widths via proportional `flex`.
- `d48f264`: hide dock/track/legend/label rows while a text field is focused (`kb-open`, `.kb-hide`).
- `3acdece`: tighten boxes/spacing/buttons while keyboard open (CSS in `index.css`).
- `e826f09`: edge-swipe opens sidebar from either side (`drawerSide`).
- `eb2933b`: edge swipe picks strings list vs sidebar by nearest button; strings list drawer made to work in landscape (`always` prop, rendered in split layout).
- `8bcdfbc`: ZIP/XML/JSON saving on Android via `saveFile` (Filesystem + Share).
- `e817b77`: writing-half blocks `shrink-0` so long text scrolls to save/skip buttons.

### Conversation notes
- Answered (no code): Android keyboard cannot be limited to half the screen; suggested Gboard floating/one-handed mode, or a custom in-app keyboard (not built).
- Every change was checked with lint, unit tests and headless Chromium screenshots; none confirmed on the user's device yet.
