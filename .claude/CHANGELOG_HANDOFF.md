# CHANGELOG_HANDOFF

Newest first. Main commit hashes where known.

## 2026-11-16/17 session — accent shades, contrast fixes, stats pill, button swap/resize, table search toggle

Branch `main` up to `6efb410`, then continued on branch **`UI-improvements`** (not merged to `main`; pushed to `origin/UI-improvements`, up to `ff03d66`). User explicitly asked for a separate branch this time instead of `main`.

### On `main` (pushed)
- **Accent shade picker** (`de0f93f`, `a4c515c`, `3473355`): `src/utils/accentVariants.ts` (new) — 4 shade variants per accent family (teal/blue/violet/rose/amber/cyan), ordered light→dark with similar hues grouped and one outlier hue last; `Header.tsx` — picking a shade keeps the column open (only re-picking the active shade closes it), outside-tap closes the column **and** swallows the click so it doesn't also activate whatever was underneath (permanent capture-phase listener + a live ref mirror of open state — a conditionally-attached listener was tried first and was timing-fragile), slow-fast-slow (`cubic-bezier(0.65,0,0.35,1)`) sliding selection-ring animation between shades, one shade-change per discrete drag gesture (was cycling repeatedly on long drags), more noticeable drag color-change animation, offline dot added next to the mobile "الجدول" toggle.
- **Contrast/theme fixes** (`fea69e8`, `3a76895`, `10df27c`, `97bf3b2`, `e9b1499`, `9225c52`, `f9fb131`): textarea bottom border follows `--accent-primary` instead of hardcoded teal; dashed border removed from the empty Files/Projects placeholder; `OfflineDot` now renders `null` while online (was always visible, green when connected); New/Updated badge moved to the physical-right of the checkbox in the **mobile card** table view only (confirmed scope via `AskUserQuestion`); light-theme low-contrast text fixed in several places by adding a darker base shade + `dark:` prefix for the original (pattern: `text-slate-300` → `text-slate-500 dark:text-slate-300`, etc.) — array/plural source-hint text, plural quantity label, editor nav footer + its hover bg, `values-xx` codes in the multi-language modal, the red "multiple spaces" warning banner, the amber "AI translated" badge.
- **Stats pill redesign** (`8fc87d7`, `6efb410`): dropped the separate "Untranslated" legend stat; "Translated" became a two-tone pill (color-coded percentage segment + dark label segment, subtle shadow for contrast); percentage color: red 0–30%, dark orange 30–60%, dark yellow 60–80%, green 80–100%; corners changed from fully round to slightly-rounded (`rounded-md`) per follow-up request.
- Multi-language modal: removed the border around each language row (`f9fb131`).

### On `UI-improvements` branch (pushed, not merged)
- **`fd90ca1` feat: swap editor action buttons by press-and-hold + vertical drag** — new `src/hooks/useColumnSwap.ts`: press-and-hold (~420ms) then drag a button up (if below its neighbour) or down (if above) swaps the two. Layered on top of the existing horizontal resize gesture (`useResizablePair`) on the same buttons without interfering (both gestures run independently; resize only reacts to `dx`, swap only to `dy`). Each of the 3 columns in `EditorActionButtons.tsx` (round icon, text button, main save pill) swaps independently and the choice is persisted. **Important structural gotcha hit here:** the resize hooks (`row1h`/`row2h`) must stay bound to the *physical row*, not to button identity — building a button's gesture handlers from "whichever row it conceptually belongs to" and then rendering it in the other row (when swapped) breaks the resize geometry, since the ref/width math assumes the DOM element is inside the hook's own grid container. Fixed by always calling `row1h`/`row2h` for the physical top/bottom row and only swapping *which content* (icon/text/main variant) renders inside.
- **`b52525a` feat: resize editor action rows to fit swapped-in content** — follow-up: the row width split (left-group vs. main button) was remembered per *physical row*, so swapping content in left a mismatched/cramped width behind. Changed `useResizablePair` to accept a reactive `storageKey` (added a `useEffect` that reloads ratio/extra when the key changes — the original lazy `useState` initializer only ran once) and key it by the *content combination* currently in that row (e.g. `editor_buttons_pair_trash_skip_continue_v1`) instead of by row number, so a row animates (existing 200ms transition) to whatever width that content pairing last had.
- **`1f6683b` UI: collapse table search into icon button** — `TableView.tsx`: replaced the always-visible search bar with a round search-icon button beside the "Translated" stats pill; tapping it expands a bar over the stats line (which fades out), morphing the icon to X via a two-icon CSS-grid-overlap crossfade (not swapped DOM nodes); closing clears the search text and restores the stats line.
- **`ec810de` fix: RTL physical-right pinning** — the toggle's anchor used a *logical* `insetInlineEnd`, which is physical-**left** under the app's RTL (Arabic) direction; combined with the browser's own RTL flex-child reordering once expanded, the button visually jumped sides between collapsed and expanded. Fixed by anchoring with plain physical `right: 0` and forcing `dir="ltr"` on the toggle's own wrapper (button last in DOM so it's last in a forced-ltr row = physical right), with the `<input>`'s own `dir`/`textAlign` set independently from `isAr` so Arabic typed text still reads naturally RTL. **Lesson: logical CSS properties (`insetInlineEnd`, `ps-*`/`pe-*`) do not mean "physical right/left" under RTL — test any such layout in both `app_ui_language` values before calling it done.**
- **`d34b926` fix: four regressions reported by the user in the toggle** (from screenshots, in the user's own numbered order): (1) lingering focus ring around the toggle button after closing — fixed by blurring it on click/mouseup and dropping the default focus outline; (2) an unrequested `focus-within` blue ring + background-color change on the whole search pill — removed entirely (it was carried over from the *old* always-visible bar's styling without being asked for again); (3) Arabic typed text sitting flush against the bar's edge — caused by `dir="auto"` on the input interacting badly with the forced-`ltr` wrapper and a *logical* `ps-3` padding resolving against the auto-detected (not the forced) direction; fixed with an explicit `dir={isAr ? 'rtl' : 'ltr'}` and plain physical `px-3`; (4) the stats pill shifted position / started overlapping the search button — caused by double-padding: the wrapper this feature added (`px-4 sm:px-5 pt-3 sm:pt-4`) stacked on top of padding the stats block (`Header.tsx`'s `'tableLegend'` part) already has on its own (`px-4 sm:px-6 pt-3 pb-0.5 md:py-2`); fixed by giving the stats wrapper *no* padding of its own (only a physical `paddingRight` to reserve room for the button) so its position/spacing matches exactly what it was before this feature existed.
- **`ff03d66` fix: expand search bar to full row width** — a `min(100%, 26rem)` cap had been added without being asked for (deviated from the original "يتسع بالكامل" / expand fully request); changed to plain `100%`.

### Pattern repeated across this whole session
User sends a screenshot, often reports a specific bug introduced by the *previous* fix; expects narrow, exact fixes only — explicitly said at one point not to add or change anything not asked for. Verify every visual change with Playwright (`nohup npx vite --port 5199 &`, screenshot before/mid-transition/after) in **both** `app_ui_language` values (`localStorage.setItem('app_ui_language','ar')` + reload) before calling something fixed — several of this session's own regressions were RTL-only and were missed on first pass because testing only covered the default/English language.

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

---
## 2026-11-11 session (main, up to `c843f14`)
- `b799f4e`/`e7f14fa`/`975f3e6`: global ordering, shared quick filters, All/AI/manual/new chips.
- `e64d7e3`/`7c095a8`: strings list performance and scroll-up fix; badge cleared on save.
- `63bec20`/`c0d6974`/`6b1a72b`/`fb45c7c`: table cleanups, source alignment, badges, selected highlight.
- `9ea5456`/`ba8af6d`: table background `#121318` (dark, all themes) / white (day), no side borders, rounded selected card.
- `8c0d05b`: docs SEO, Website badge, Google verification file, sitemap/robots.
- `8124764`: plural/array type filters (mixed files only); summary header toggles card.
- `74e27d1`/`c843f14`: editor resize only from the pill; no translucent bar.
