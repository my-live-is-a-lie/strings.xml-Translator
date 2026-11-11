# WORK_STATE

Last updated: 2026-11-02. Branch `main`, working tree clean after the add-language commit (`3c30387`).

## Done
- "Add app language" feature complete and pushed: "+" button at the far end of the settings-drawer language strip (scrollable/draggable), modal with instructions, English `strings.xml` download, upload of translated file with name + RTL/LTR, delete of added languages, persistence across reloads.
- Empty-value semantics implemented: empty explanatory text hidden; icon+text button keeps only icon; text-only button falls back to English; missing key -> English; overflow clipped.
- Verified: tsc, eslint, vitest (67), build; text snapshots for ar/en identical to the pre-refactor baseline; Playwright e2e of add-language flow passed.

## Known gaps / possible next steps
- ~35 ternaries were NOT converted (non-string branches: `messageAr/messageEn`, `labelAr/nameAr` objects, `getArabicLanguageName`, plural/array type labels, `QaSection` counts, `PWAInstallButton` instructions, `TranslationEditor` undo/redo titles, etc.). With a custom RTL language they show Arabic, with a custom LTR language English. Convert gradually to keys.
- The modal's "edit before upload" is done by editing the file externally; no in-app editor for a language's texts or re-upload to update an existing language.
- Not exhaustively tested in a browser: every deletion case (e.g. text-only button emptied) and clipping in all screens.
- Optional earlier offer: progressive collapsing header for table view like the strings list.
- User must delete remote branch `table-scroll-header` on GitHub.

---

# Landscape / editor session (separate Claude session, 2026-11-03)


### Repo state
- Branch `main`, last pushed commit `e817b77` ("Landscape: stop writing-half blocks from collapsing…"). Working tree clean apart from this `.claude/` handoff.
- Lint, 65 unit tests and `vite build` pass locally. e2e only runs in CI.

### Done and pushed (not yet confirmed on a real device)
All items below were verified only in headless Chromium (landscape ~780x360), not on the user's phone:
- Landscape split layout, bottom dock, offline dot with real connectivity probe, filters replacing stats, compact buttons.
- Keyboard-open compaction (hide bars/labels, tighten spacing).
- Edge-swipe drawers (strings list vs sidebar by nearest button).
- ZIP/XML/JSON saving on Android via share sheet.
- Long text scrolling to the save buttons in the writing half.

### Waiting on the user
- Start a NEW release run (Actions → Release signed Android APK → Run workflow; Re-run reuses old code) and test on the phone. Report back with screenshots if anything differs. The ZIP fix needs this build because it adds two Capacitor plugins.

### Open points / risks
- Keyboard-open detection is focus-based (a text field is focused), not real keyboard height; if the keyboard is dismissed with Back while the caret stays in the field the bars stay hidden until focus leaves. Offered but not requested: measure viewport height instead.
- Edge swipe may clash with Android's system back gesture at screen edges; widening the edge zone (currently 28 px) or other tuning may be needed.
- "Connected" state of the offline dot could not be tested in the sandbox (no external network).
- Whether the landscape split appears on the user's APK after rotation was reported broken once and fixed (cf3ae53/f369fa7); confirm on device.
- User asked for a handoff (`.claude/PROJECT_CONTEXT.md`, `WORK_STATE.md`, `CHANGELOG_HANDOFF.md`); these three files are that handoff.

### Suggested next steps
1. Confirm the new release on device; fix whatever the user reports.
2. Consider tying keyboard-open mode to actual viewport shrink.
3. Possible follow-ups the user hasn't asked for: an in-app compact keyboard (declined as too big for now); float/one-handed keyboard advice was given instead.

---
# Session update (2026-11-11): table, filters, docs/SEO, editor pill
Last pushed commit when written: `c843f14`. Lint + 114 vitest tests pass. Everything verified in headless Chromium only, NOT on the user's phone.

### Done and pushed
- **Order/filters (earlier in session):** one global order (translated → untranslated → needs review, `src/utils/stringOrder.ts`); fresh start opens on first string needing work; one shared quick-filter state (`src/utils/quickFilters.ts`, key `app_quick_filters_v1`) used by editor, strings list and table; All clears everything; counts follow filters.
- **Strings list perf/scroll:** windowed rows, no hidden desktop list on phones, spacer-based reload when scrolling up; no green check in rows; new/updated badge cleared on save.
- **Table page:** key names clickable (open editor), selected row highlighted like the list, no status circle, badges next to status icon; background is one flat colour: `#121318` in dark mode in every theme (class `tv-bg` + rule in `index.css` that beats theme overrides), white in day mode with no side borders; selected card rounded (phone cards only; wide table rows still rectangular).
- **Type filters:** `plural` / `array` quick filters (`availableTypeFilters`). Shown only when the file mixes ≥2 kinds of resources (string/plural/array); single-kind files show none. Group is OR'ed inside, AND'ed with other groups.
- **Strings list summary card:** whole header row toggles it (arrow and "show all" button stop propagation).
- **Editor resize pill (`HighlightedTextarea.tsx`):** height resize only from the pill (`data-resize-handle`, ~96px hit area); touch gestures that start elsewhere never resize (`onHandle` flag in the touch listener); translucent bar under the pill removed. Rearrange-by-swipe still works on the whole box.
- **Docs site / SEO:** `scripts/build-docs.mjs` generates `docs/index.html` (title, description, canonical, OG/Twitter, JSON-LD SoftwareApplication, hero lead text), plus `docs/robots.txt`, `docs/sitemap.xml`. README badge renamed Website with a globe icon. Google Search Console ownership verified via `docs/googlec8cc6f1af188f4fa.html` (never delete it). Sitemap submitted (status "couldn't fetch" at first, normal); indexing requested for the home page. `npm run docs` needs `marked` (installed with `--no-save`).

### Waiting on the user
- Start a NEW release run (Run workflow, not Re-run) and test on the phone: table backgrounds, type filters, pill-only resize, summary toggle.
- Check Search Console in a few days (URL inspection should change to "on Google").

### Notes
- User wants: Arabic replies, concise; no pushes when he says "don't push until I ask"; another Claude session may push to main (use `git pull --rebase`).
