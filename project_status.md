# Loom project status

**Updated:** 3 November 2026

**Overall:** Phase 1 application scaffold and Prism-reference workspace implemented and verified on Linux x86_64. Phase 2 is authorized and in progress.

**Current milestone:** Phase 1 exit criteria passed. Independent review completed by GPT-6.1 Terra at medium effort, the user-authorized fallback. Both reported Phase 1 defects were fixed and the follow-up review found no additional actionable defects.

## Repository

| Item              | State                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| Workspace         | Phase 1 changes on `codex/phase-1-workspace`; use Git for exact commit/push state       |
| GitHub repository | Private `monabji/loom`, previously verified; `origin` configured for branch publication |
| Application       | Electron 45.2.1, TypeScript 6.0.3, electron-vite 6.0.0, Vite 8.3.5, SolidJS 1.9.18      |
| Dependencies      | Exact direct versions and lockfile; npm 11.19.0, tested with Node 26.7.0                |
| Commands          | Install/dev/preview/format/typecheck/test/build/package in package.json and README.md   |
| Linux artifact    | `release/linux-unpacked/loom`, built and launched locally; ignored generated output     |

## Build progress

| Phase                         | Status      | Evidence                                                                                                    |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| 0 — Repository/readiness      | Complete    | Prior documentation/private remote baseline verification                                                    |
| 1 — Scaffold/workspace        | Complete    | Source, 22 deterministic tests, 4 real Electron tests, browser preview, screenshots, unpacked package smoke |
| 2 — Projects/persistence      | Not started | No project/editor/document persistence implementation                                                       |
| 3 — LaTeX/PDF                 | Not started | Source and paper are explicitly read-only/static examples                                                   |
| 4 — OpenCode agent            | Not started | No harness/model/provider calls from the product                                                            |
| 5 — Literature/Zotero         | Not started | Requirements only                                                                                           |
| 6 — Scientific content/images | Not started | Requirements only                                                                                           |
| 7 — Git/export workflows      | Not started | Requirements only; development branch is not product Git implementation                                     |
| 8 — Hardening/pilot           | Not started | No installed-package, cross-platform, full workflow or performance validation                               |

## Phase 1 implementation

- Sandboxed Electron window with context isolation and no renderer Node integration; deny navigation, popups, webviews and permissions.
- Named preload API: status, service restart and validated events. Strict Zod requests/results/events; exact sender/top-frame/origin/path checks in main.
- Separate Electron utility process, correlated round trips, five-second bounds, bounded pending requests, typed operation errors, child-generation isolation and shutdown/restart recovery. No filesystem/project commands.
- Prism-reference Files/Chats sidebar, collapsible Outline, source surface with line numbers/highlighting, center-column bottom composer, and light paper surface.
- Empty first launch, user-triggered synthetic example, read-only/static labels and specific later-phase availability dialogs. Browser preview reports missing native service truthfully.
- Pointer and keyboard resizing, sliders, hide/restore, Source/PDF/Split focus modes, F6 navigation, keyboard-accessible modal settings/tools and notifications. Below 1100px, explicit single-panel focus views.
- Validated versioned layout preferences with recovery defaults and storage-error feedback. This stores presentation only; Phase 2 SQLite/Yjs/document persistence remains unimplemented.
- Shared UI primitives and CSS tokens, global scrollbars, visible keyboard focus, reduced-motion and forced-color handling; ownership and calibrated reference choices recorded in DESIGN.md.
- Full action/expected-output guide in `docs/phase-1-testing.md`.

## Verification evidence

| Check                      | Observed result                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency installation    | `npm install` passed; exact compatible dependencies locked                                                                                                                                                                                                                                                                                                                 |
| Static/build checks        | `npm run check` passed: formatting, TypeScript, 22 tests, all production bundles                                                                                                                                                                                                                                                                                           |
| Contract/lifecycle tests   | 15 passed: strict validation, startup/ping correlation, crash/error, restart, stale messages, timeout, queue bound, spawn/send failure, terminal-child retirement, pending-timer cleanup, termination exceptions and unsubscribe                                                                                                                                           |
| Layout tests               | 7 passed: validated round trip, invalid/version/bounds recovery, blocked/full storage and independent defaults                                                                                                                                                                                                                                                             |
| Actual Electron acceptance | `npm run test:e2e`: 4 passed with `chromiumSandbox: true` (no `--no-sandbox`); actual isolated window/API, popup/navigation rejection, service restart/crash/SIGSTOP timeout/recovery, keyboard/saved layout and smaller views                                                                                                                                             |
| Visual comparison          | Actual Electron screenshots at 2048×1096 and 900×700 inspected against the supplied Prism reference; composer stays in center column. Files: `artifacts/phase-1-electron-reference.png`, `phase-1-electron-small-source.png`, `phase-1-electron-small-pdf.png`                                                                                                             |
| Browser preview            | Shared renderer exercised at reference, 1280×800 and 900×700 widths; example, tools/modal focus containment/Escape/return, focused Source/PDF, no page overflow, honest unavailable service                                                                                                                                                                                |
| Packaging                  | `npm run package` passed; unpacked Linux executable launched with sandbox enabled, actual utility returned ready/PID/version and example displayed; `artifacts/phase-1-packaged.png`                                                                                                                                                                                       |
| Design lint                | `designmd lint DESIGN.md`: zero errors/warnings                                                                                                                                                                                                                                                                                                                            |
| UI audit                   | Strict skill audit: zero findings; generated JSON under ignored `artifacts/`                                                                                                                                                                                                                                                                                               |
| Dependency audit           | Production dependencies: zero reported vulnerabilities. Full dependency tree: 15 moderate findings in electron-builder packaging dependencies, no high/critical findings; recorded in `artifacts/npm-audit*.json`                                                                                                                                                          |
| Whitespace                 | `git diff --check` passed                                                                                                                                                                                                                                                                                                                                                  |
| Gemini availability        | Requested Gemini 4 Argon through direct Antigravity. First direct task failed to open its provider session before starting; bounded retry rejected with `model_unavailable`: model no longer advertised by direct Antigravity. No review or low-effort setting was verified. Initial ACP attempt also failed and was superseded by the user’s direct-provider instruction. |
| Terra review               | GPT-6.1 Terra medium independently inspected source and screenshots. Fixed broken Skip to source in PDF focus mode and retained-child transport failure. Follow-up verified both fixes and found no additional actionable defects; reviewer did not rerun the suites. See docs/phase-1-review.md.                                                                          |

Generated artifacts are local evidence, ignored by Git. Tests use isolated temporary preferences and synthetic source. Fake-transport tests are separate from real Electron acceptance. The paper surface is HTML, not a compiled PDF. No external provider integration in the product is claimed.

## Current decisions and limitations

- Original launch decisions remain: free Electron desktop, Linux x86_64 pilot, OpenCode first, installed TeX detection later, ordinary LaTeX files, Yjs document bridge later, no required account.
- Phase 1 alone stores presentation preferences in local storage; architecture documents this temporary exception to future SQLite metadata.
- Reference match is calibrated, not a claim about Prism’s original fonts/CSS or undocumented menus.
- AppImage generation/installation, Windows/macOS, TeX, OpenCode, Zotero, Git/export workflows, IME and performance targets are not verified here.
- Packaging dependency audit findings remain; avoid describing this foundation artifact as a hardened release.
- Gemini 4 Argon could not start through direct Antigravity and disappeared from that provider’s advertised models. The user explicitly authorized GPT-6.1 Terra medium as the fallback; that review and follow-up completed.

## Next task

Implement and verify the Phase 2 project/editor workflow, then obtain the requested GPT-6-Luna medium independent review.

## Phase 2 service foundation (in progress)

- Added validated project commands, native folder/ZIP selection, utility-process project service, SQLite schema v1, stable file identities, recovery checkpoints, serialized atomic saves, and baseline reconciliation.
- Nine new deterministic service tests pass (31 total): ordinary/non-ASCII paths, rename, binary delete/restore, overlap/disjoint edits, duplicate refresh, interrupted rename, reopen divergence, imports, path protection and migration guard.
- Renderer integration and real Electron persistence verification remain pending; Phase 2 gates remain unchecked.

## Phase 2 editor workflow (in progress)

- Added CodeMirror/Yjs editing, IndexedDB recovery, project picker/file operations, tabs, section outline, explicit save, conflict review, font/wrapping and per-file caret preferences.
- First GPT-6-Luna medium review completed; identified seven gaps. Fixed overlapping dialogs, pending-edit reconciliation with baseline preconditions, reconnect, caret restoration, explicit search extension, SQLite derived indexes and on-demand snapshot payloads. Follow-up review remains pending.
- Two new real Electron workflow tests now pass: opening through the native-picker boundary, editing/disk acknowledgment, tabs, external edit/reload, service restart, 2048×1096 and 900×700 views; unsent overlapping edits survive reload and resolve explicitly. Native dialog results are supplied by the test; real project service/CodeMirror/IndexedDB/disk I/O run normally.
- UI static audit: zero findings. Full regression, additional recovery scenarios, final docs and reviewer follow-up remain pending.

## Phase 2 review fixes and regression expansion (in progress)

- Luna follow-up found the seven original gaps addressed and requested line/snippet/jump results for project text search; implemented those bounded results with navigation and clear/IME handling.
- Added disk fingerprints and binary-vs-deletion conflict handling, interrupted deletion recovery, exclusive folder import destinations, empty-file Yjs initialization, distinct native-project/file commands and rollback of failed project opens.
- Added incremental external patches, native close preference flush and replacement-window recovery after renderer termination. The Electron debugger's force-crash API hung before emitting termination; acceptance instead uses actual renderer SIGKILL, with committed IndexedDB updates and disk divergence.
- Deterministic suite now passes 40 tests; nine Electron cases passed before final close/reopen/undo checks were added. Linux unpacked packaging passed. Final full regression and final review remain in progress.

- Full native close/reopen test passed, including pending text flush and restored caret. Added undo/redo regression against external changes; found and fixed the Linux Ctrl Shift Z event path while retaining Yjs undo ownership. Focused editor workflow now passes with external text preserved through undo/redo. Final full-suite rerun follows.

- Luna final pass identified ignored preference-write failure during native close. Close and project-switch now require successful working-state persistence; a simulated main-IPC failure regression confirms the window remains open with the error visible. Unpacked Linux smoke opened/edited/saved ordinary source through its actual utility/SQLite service; the final artifact will be rebuilt after this fix.
