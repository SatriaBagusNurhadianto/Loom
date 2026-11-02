# Loom project status

**Updated:** 3 November 2026

**Overall:** Phases 0–2 complete for the exercised Linux x86_64 desktop target. Phase 2 projects, source editing and reliable local persistence are implemented and verified. Phase 3 has not started.

**Current milestone:** A real ordinary LaTeX project opens, edits, saves and reopens. External overlaps remain reviewable; unsent IndexedDB recovery survives renderer/service termination and disk divergence. GPT-6-Luna medium reviewed four rounds; all reported findings were addressed, with no additional actionable blocker in its final reviewed paths.

## Repository

| Item                | State                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work branch         | `codex/phase-2-persistence`; focused service, editor, recovery, undo, close-failure and documentation commits; use Git for exact state                                             |
| Remote              | Private `monabji/loom`, origin inherited from Phase 1; no Phase 2 push or publication requested/performed                                                                          |
| Application         | Electron 45.2.1, TypeScript 6.0.3, electron-vite 6.0.0, SolidJS 1.9.18; exact dependencies and lockfile                                                                            |
| Editing/persistence | CodeMirror 6, Yjs, y-indexeddb, Node SQLite schema v2 in the utility process                                                                                                       |
| Local artifact      | `release/linux-unpacked/loom`, built and exercised with sandbox enabled; generated output ignored                                                                                  |
| Guides              | [Phase 2 testing](docs/phase-2-testing.md), [independent review](docs/phase-2-review.md), [historical Phase 1 tests](docs/phase-1-testing.md) and [review](docs/phase-1-review.md) |

## Build progress

| Phase                         | Status      | Evidence                                                                                                               |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0 — Repository/readiness      | Complete    | Existing documented/private remote baseline                                                                            |
| 1 — Scaffold/workspace        | Complete    | Existing shell, security/lifecycle/layout acceptance, reference screenshots and package evidence; regressions retained |
| 2 — Projects/persistence      | Complete    | 40 deterministic tests, 11 real Electron cases, package smoke, visual checks and four Luna medium review rounds        |
| 3 — LaTeX/PDF                 | Not started | No TeX, TexLab, PDF.js or source/PDF mapping integration                                                               |
| 4 — OpenCode agent            | Not started | Product sends no model/provider calls; reviewer delegation is development tooling only                                 |
| 5 — Literature/Zotero         | Not started | Requirements only                                                                                                      |
| 6 — Scientific content/images | Not started | Requirements only                                                                                                      |
| 7 — Git/export                | Not started | No product clone/commit/push/export UI; source already remains ordinary portable files                                 |
| 8 — Hardening/pilot           | Not started | Full performance/IME, installed distribution, cross-platform and end-to-end release acceptance remain                  |

## Phase 2 implementation

- Native open/create/import-folder/import-ZIP workflows. Creation supplies an ordinary article template; imports create a new copy. Sources, `.bib`, custom class/style files and binary assets remain in their original formats. No configuration is written merely to inspect a clean project.
- Stable manifest/file IDs, likely-root detection and explicit selection, nested create/rename/move, deletion checkpoints and restore. External observed renames retain identity; missing files and binary replacements have distinct conflict semantics.
- CodeMirror source editor: LaTeX highlighting, line numbers, find/replace, indentation, wrapping/font settings, tabs, section outline and keyboard save/undo/redo. External patches use Yjs transactions; editor selection and undo ownership remain separate from project recovery.
- Per-file IndexedDB Yjs recovery with acknowledged bridge baselines. SQLite WAL/FULL metadata, versioned v1→v2 migration, project/working-state preferences, recoverable source/deleted bytes and rebuildable derived search index. Newer schemas are rejected. Checkpoints remain until application data is explicitly removed; no automatic recovery cleanup exists yet.
- Serialized utility-process filesystem bridge: content-based observation, known-write suppression, baseline-aware reconciliation, revision acknowledgment, recovery checkpoint before atomic write, file/directory synchronization and disk recheck. Dirty renderer replicas do not accept stale acknowledgments.
- Explicit overlap review retains baseline/local/disk inputs and validates the current disk fingerprint. Compatible changes merge. Reload, utility reconnect, renderer termination and reopen divergence recover before further saves.
- Native close flushes text and working state; failed persistence keeps the window open. Renderer termination creates a replacement sandboxed window with bounded retry. File payloads load on demand; service-side indexed search returns bounded path/line/snippet/offset locations and jump navigation.
- Preserved Prism shell, bottom-center composer, shared modal/token/notification ownership and smaller-desktop project access. PDF/assistant/later-phase controls retain honest availability states.
- The Files sidebar **+** opens the project picker when no real project is open; the workspace example is identified as read-only instead of showing an obsolete Phase 1 file-operations notice.

## Verification evidence

| Check                        | Observed result                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`              | Passed: formatting, TypeScript, 40 deterministic tests and all production bundles                                                                                                                                                                                                                                                                                               |
| Deterministic coverage       | 17 contract/lifecycle checks, 7 layout checks and 16 project checks. Includes stale renderer updates, compatible/overlapping changes, duplicate observation, interrupted atomic rename, reopen divergence, Unicode/external rename/deletion, binary restore/replacement, ZIP/path protection, failed-open rollback, index rebuild/on-demand payloads and schema migration/guard |
| `npm run test:e2e`           | 11 passed in final run with `chromiumSandbox: true`; real isolated Electron/preload/utility/SQLite/IndexedDB/CodeMirror/filesystem                                                                                                                                                                                                                                              |
| Electron workflow coverage   | Native-picker boundary, edit/save/reload, external reconciliation, restart, undo/redo retaining external work, Unicode create/rename/root/delete/restore, search locations, find/replace, caret retention, native project create/ZIP import, native close/full app reopen and renderer/service termination with IndexedDB-only recovery                                         |
| Simulated failure boundaries | Native picker results choose synthetic folders/archives. One main-IPC preference failure is injected to verify close refusal. Fake transport tests cover bounded/interrupted requests. These are distinguished from actual disk/process checks                                                                                                                                  |
| Visual inspection            | Actual Electron at 2048×1096 and 900×700 compared with Prism reference; composer remains in center column and smaller project dialog is usable. `artifacts/phase-2-electron-reference.png`, `phase-2-electron-small.png`                                                                                                                                                        |
| Package                      | `npm run package` passed; final unpacked executable opens a synthetic project, edits and saves ordinary source through its real utility/SQLite service with sandbox enabled. `artifacts/phase-2-packaged.png`                                                                                                                                                                   |
| UI/design                    | Strict audit zero findings; DESIGN lint zero errors/warnings; shared tokens, modal focus and keyboard/narrow states checked                                                                                                                                                                                                                                                     |
| Production dependency audit  | Zero reported vulnerabilities; Phase 1 packaging dependency moderate findings remain a hardening concern, not a Phase 2 production-library change                                                                                                                                                                                                                               |
| Whitespace/docs              | `git diff --check` passed; Markdown links checked locally; all project Markdown synchronized with Phase 2 and historical evidence labeled                                                                                                                                                                                                                                       |
| Independent review           | GPT-6-Luna medium, four new delegated tasks. Modal, reconciliation, reconnect, caret, search/index/payload and close-preference findings fixed. Final follow-up found no additional actionable blocker in the reviewed close/persistence paths; it did not independently rerun the final broad Electron suite                                                                   |

Generated artifacts are ignored local evidence. Fixtures are synthetic. No live TeX, OpenCode, Zotero, product Git, cloud or external-provider integration is claimed.

## Limits and remaining release work

- Exercised target: Linux x86_64. Text editing requires UTF-8, at most 8 MiB/file; indexing input is capped at 32 MiB and 2,000 files. ZIP limits: 64 MiB compressed, 128 MiB expanded. Search shows up to 200 locations. Larger/binary assets stay ordinary files. Symlink paths are excluded.
- Content polling observes external changes once per second while connected and before operations. The final compare/rename cannot lock unrelated external writers; later observation rechecks divergence. Full concurrent-writer/performance hardening remains Phase 8 work.
- Active documents have durable Yjs checkpoints, but no cloud sync exists. Deleting application data removes recovery stores. The startup/browser layout fallback still uses validated local storage; project-specific working state is SQLite.
- Automatic renderer recovery is bounded to two replacements per application run. Electron's debugger force-crash call hung before termination during test development; final acceptance uses actual OS renderer SIGKILL and verifies replacement/recovery instead.
- AppImage installation, Windows/macOS, full IME and large-project performance targets, physical disk-exhaustion/power-loss testing and the complete research workflow remain unverified. A packaged smoke is not an installed pilot release.
- Root inference selects only a unique `\\documentclass` candidate; ambiguous projects require explicit root selection. Rich label/citation/figure navigation and language diagnostics belong to Phase 3.

## Next concrete task

Phase 3: detect installed TeX engines/latexmk/BibTeX/Biber, establish portable build settings and revision-associated build snapshots, then connect TexLab, compilation and PDF.js according to [phases.md](phases.md). No Phase 3 implementation was started by this task.
