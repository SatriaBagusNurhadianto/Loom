# Phase 2 testing

Use `npm ci`, `npm run build`, and `npm start` for the real Electron application. Browser preview cannot access native projects. Tests use synthetic manuscripts and isolated application data. No TeX, provider credentials or Git operations are involved.

## Project workflow

1. The built-in workspace example is read-only. Choose **Open or create project → Create project**, then a new folder name. Expect an ordinary `main.tex`, an inferred root, and an editable CodeMirror surface. In the Files sidebar, **+** opens the project picker when no project is open.
2. Open an existing multi-file folder. Opening a clean project must not change its source/assets. Import folder and Import ZIP create a new copy; existing destinations and unsafe ZIP paths are rejected.
3. Choose files, create `章节/结果.tex`, rename/move it to `sections/results.tex`, select it as root, and delete it. Expand **Recover deleted files** and restore it. Original binary assets remain byte-for-byte files; text editing is unavailable for them.
4. Search for text found inside a file. Results include path, line and snippet; selecting a location opens the file at that offset. Clear returns to the full list. Up to 200 locations are shown.
5. Use **Find / replace** or Ctrl F for CodeMirror search. Use Ctrl Z / Ctrl Shift Z for editor undo/redo, Tab for indentation, and Ctrl S or **Save** to flush. Editor undo is separate from deleted-file recovery.
6. Switch tabs and reopen. Active file, tabs, font, wrapping, layout and per-file caret/selection/scroll should restore. Native close flushes pending text and working-state preferences before a full application reopen. Use **Project** for file navigation/settings at a smaller desktop width.

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

`tests/e2e/desktop.spec.ts` launches actual sandboxed Electron. Native picker return values are stubbed to choose synthetic folders, while preload, utility process, CodeMirror, IndexedDB and disk I/O are real. It covers project editing/reopen/restart, overlap review, file operations/search/selection and renderer-termination recovery of IndexedDB-only edits. This is not a claim of manually exercising every platform's native dialog.

Generated screenshots, packaging and audit outputs are ignored local evidence under `artifacts/`. Current observed results and limitations are recorded in [project_status.md](../project_status.md), and independent review findings/responses in [phase-2-review.md](phase-2-review.md).

## Limits

Linux x86_64 only has been exercised. Text files must be UTF-8 and at most 8 MiB; scan/index input is bounded to 32 MiB and 2,000 files. ZIP import limits are 64 MiB compressed and 128 MiB expanded. Symlink paths are excluded. Conflict refresh uses content polling rather than platform-specific watcher delivery. The final compare/rename cannot lock unrelated external writers; continued external mutation is rechecked on the next observation. Full performance, IME, installed-package and Windows/macOS coverage remain Phase 8 work. PDF compilation, agents, clone/export UI and references are later phases.
