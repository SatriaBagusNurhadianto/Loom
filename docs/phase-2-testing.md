# Phase 2 testing

This remains the persistence/recovery regression guide. The current LaTeX/PDF workflow and sample projects are documented in [Phase 3 testing](phase-3-testing.md).

Use `npm ci`, `npm run build`, and `npm start` for the real Electron application. Browser preview cannot access native projects. Tests use synthetic manuscripts and isolated application data. No TeX, provider credentials or Git operations are involved.

## Project workflow

1. The built-in workspace example is read-only. Choose **Open or create project → Create project**, then a new folder name. Expect an ordinary `main.tex`, an inferred root, and an editable CodeMirror surface. In the Files sidebar, **+** opens the project picker when no project is open.
2. Open an existing multi-file folder. Opening a clean project must not change its source/assets. Import folder and Import ZIP create a new copy; existing destinations and unsafe ZIP paths are rejected.
3. Choose **New file** to open the native save picker inside the project, create `章节/结果.tex`, use the file row’s **…** menu to rename/move it to `sections/results.tex`, select it as root, and delete it. Use **Project file options → Deleted files** to restore it. Folder **+** starts the native picker in that folder. In the compact navigator, successful creation closes the navigator and focuses the new source; cancellation leaves it open, and rejected destinations show an inline error. Original binary assets remain byte-for-byte files; text editing is unavailable for them.
4. Click the sidebar search icon. Try `mtex` to find `main.tex`, or `intrduction` to find `Introduction`. Results rank exact matches before small word/phrase typos and filename abbreviations. Matched characters/words are highlighted in filenames, snippets and the source. Select a text result with click or Tab/Enter: its actual passage is selected and focused in the editor. Clear removes highlights and returns to the full list. Up to 200 results are shown, with up to 20 content locations per file; long-line snippets crop around the match. Search refreshes when project files change, pauses during IME composition, and survives compact-navigator selection. Numbers, short words and punctuation-heavy expressions stay literal in content search.
5. Use **Find / replace** or Ctrl F for precise CodeMirror search; its highlights take precedence while open, and replace never uses fuzzy matching. The panel uses Loom's rounded fields/buttons and neutral focus treatment. Check match case, regexp and whole-word options; Escape closes the panel and returns focus to the source. At 720×540, controls should remain inside the panel and usable. Clicking a file tab must not add a blue box; Tab/F6 retain a subtle gray keyboard indicator. Use Ctrl Z / Ctrl Shift Z for editor undo/redo, Tab for indentation, and Ctrl S or **Save** to flush. Search highlights do not modify source or undo history. Editor undo is separate from deleted-file recovery.
6. Switch tabs and reopen. Active file, tabs, font, wrapping, layout and per-file caret/selection/scroll should restore. Native close flushes pending text and working-state preferences before a full application reopen. Use the toolbar **Project** icon for compact file navigation at a smaller desktop width, and **Project settings** for open/import/preferences.
7. Close the PDF pane with **×**, then use **Preview** beside Tools to reopen it. The same button toggles it off again; the hidden preference survives reload. Closing from the PDF header returns focus to the toggle. At a smaller width, Preview opens the PDF focus view; **Source**, **Return to workspace** or the close button brings the editor back. Opening/closing the side pane must preserve the live editor and source text. This is pane navigation; a compiled PDF arrives in Phase 3.

## Integrity and recovery

- Edit normally. **Saved to disk** appears only after a matching revision has reached disk; editing immediately clears it. Files remain ordinary UTF-8 source. Recovery metadata lives in application data, outside the project.
- With Loom open, make an external edit. Compatible edits merge; overlapping changes show **External changes need review** and preserve local, baseline and disk versions. Inspect comparison, then **Keep local text** or **Use disk version**. A newer disk revision invalidates an older resolution choice.
- Rename externally: the next refresh retains identity where inode observation permits. External deletion offers explicit recovery/conflict behavior. Replacing source with binary data is shown distinctly from deletion; keeping disk retains the asset, while keeping local text explicitly restores source.
- Restart the local service from diagnostics. The project reconnects and pending recovered text is reconciled before saving. Closing the native window requests a document flush; failed persistence keeps the window available for recovery.
- Reopen after disk divergence. Recovery is independent of Git. Do not delete application data when testing recovery; it owns checkpoints and IndexedDB.

## Automated checks and evidence

```bash
npm run check
npm run test:e2e
npm run package
```

`tests/projects.test.ts` covers real temporary filesystem/SQLite/Yjs operations: concurrent edits including stale replicas, duplicate observations, interrupted atomic rename, reopen divergence, Unicode paths, external rename/deletion, binary recovery/replacement, safe imports, indexed search, on-demand snapshot payloads and schema guards. `tests/contracts.test.ts` separately covers fake-transport lifecycle failures and bounded project requests.

`tests/search.test.ts` covers fuzzy matching, ranking, Unicode offsets and literal scientific expressions. `tests/search-session.test.ts` uses Solid's client reactivity with simulated responses/timers to check debouncing, composition, stale success/failure, clear, project changes and retry. Electron cases exercise actual result/source decorations, precise Find coexistence, undo, external-file result refresh, keyboard focus, contrast and compact navigation. `artifacts/phase-2-fuzzy-search.png` and `phase-2-fuzzy-search-small.png` capture the new states.

`tests/e2e/desktop.spec.ts` launches actual sandboxed Electron. Native picker return values are stubbed to choose synthetic folders, while preload, utility process, CodeMirror, IndexedDB and disk I/O are real. It covers project editing/reopen/restart, overlap review, file operations/search/selection and renderer-termination recovery of IndexedDB-only edits. This is not a claim of manually exercising every platform's native dialog.

Generated screenshots, packaging and audit outputs are ignored local evidence under `artifacts/`. Current observed results and limitations are recorded in [project_status.md](../project_status.md), and independent review findings/responses in [phase-2-review.md](phase-2-review.md).

## Limits

Linux x86_64 only has been exercised. Text files must be UTF-8 and at most 8 MiB; scan/index input is bounded to 32 MiB and 2,000 files. ZIP import limits are 64 MiB compressed and 128 MiB expanded. Symlink paths are excluded. Conflict refresh uses one-second filesystem observation rather than platform-specific watcher delivery. Unchanged file metadata permits reuse of previously hashed content during observation; operation refreshes still read content. Cache invalidation includes nanosecond mtime/ctime, size, device/inode and mode, so ordinary writes, timestamp-restored writes and atomic replacement are observed. A filesystem that permits content changes without changing any of those fields can defer observation until an authoritative operation refresh. The final compare/rename cannot lock unrelated external writers; continued external mutation is rechecked on the next observation. Full performance, IME, installed-package and Windows/macOS coverage remain Phase 8 work. PDF compilation and PDF export are now covered by Phase 3; agents, clone/source-export UI and research references remain later phases.

## Typing while saves are acknowledged

Type continuously for several seconds while automatic PDF updates are enabled. Ordinary typing, polling and overlapping save requests must not show **External changes need review**. After a pause, all text should reach disk and the PDF should update. `tests/document-saving.test.ts` delays an acknowledgment after a real filesystem write while additional typing/flushes overlap; it also distinguishes compatible external edits from true overlapping replacements. IndexedDB timing is simulated in that focused test; actual IndexedDB/editor/process behavior is covered by Electron tests.

An already recorded conflict from an older run is not automatically dismissed: compare its preserved versions and choose the intended one. The fix prevents new false conflicts without treating genuine external replacements as safe to overwrite.
