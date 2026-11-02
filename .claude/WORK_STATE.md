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
