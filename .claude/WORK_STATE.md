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
