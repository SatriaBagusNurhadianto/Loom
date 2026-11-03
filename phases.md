# First desktop build plan

**Scope:** The first public desktop release defined in [PRD.md](PRD.md), through its M6 pilot milestone. This plan does not include accounts, cloud synchronization, live collaboration, hosted compilation, harnesses beyond OpenCode/Codex, voice, or visual prose editing.

**Current state:** Phases 1–4 implemented and verified on Linux x86_64. Next: Phase 5 literature and Zotero. Actual progress and verification belong in [project_status.md](project_status.md).

## How to execute this plan

- Work in dependency order. Start a phase when its prerequisites are satisfied; finish it when all exit criteria have evidence.
- Treat checkboxes as observed completion, not a list of intentions. Leave partially verified work incomplete and state what remains in the status document.
- Map work to the listed PRD requirements. Record an explicit product decision before removing a launch capability or adding a later-phase service.
- Add real setup/check commands after scaffolding establishes them. Actual application commands are recorded in README.md and package.json.
- Use synthetic projects and deterministic integration fixtures for repeatable checks; record live tool/provider verification separately.

## Phase 0 — Repository and implementation readiness

**PRD coverage:** Decision provenance, scope, architecture, and release acceptance.

**Prerequisites:** PRD and visual reference available.

- [x] Create and link the product, agent, architecture, design, phase, and status documents.
- [x] Initialize the private GitHub repository, choose `main` as its default branch, and verify the initial documentation push.
- [x] Confirm the first-build defaults are recorded: OpenCode first, Linux x86_64 pilot, detected TeX tools, no required Loom account.
- [x] Record actual repository state and the next implementation task.

**Exit:** Documentation links resolve, documents agree on scope, the remote exists with the intended visibility, and local `main` matches the pushed branch. No application completion is implied.

## Phase 1 — Application scaffold and Prism workspace

**PRD coverage:** FR-01, FR-02 and FR-13 foundation; UI Section 6.

**Prerequisites:** Phase 0 complete.

- [x] Scaffold Electron, TypeScript, electron-vite, SolidJS, preload, and utility-process communication; pin compatible dependencies and the package manager.
- [x] Establish shared validated command/event contracts, operation errors, and process ownership.
- [x] Record actual install, development, formatting, typecheck, test, and package commands in the project scripts/README.
- [x] Build the Prism-reference three-column shell with a Files/Chats sidebar, outline region, central source area/composer, and right PDF surface.
- [x] Establish shared tokens/primitives and synchronize their ownership with DESIGN.md.
- [x] Implement resizable/collapsible panels, keyboard focus, saved layout, and smaller-window focus modes.
- [x] Add actionable empty/loading/error states; represent unavailable later-phase controls honestly.

**Verification:** Launch the real Electron app; inspect process boundaries and keyboard behavior. Compare screenshots at the reference proportions and a smaller desktop size. Run established static/build checks.

**Exit:** A packaged/development workspace opens reliably, the layout matches the supplied reference in the default state, and visible foundation controls work. A static screenshot alone is insufficient.

## Phase 2 — Projects, document state, and reliable local persistence

**PRD coverage:** FR-01, FR-02, FR-13; document integrity Section 8.

**Prerequisites:** Phase 1 complete.

- [x] Open/create/import project folders and ZIPs; preserve original LaTeX and assets.
- [x] Add file manifest, stable IDs, root-document selection, file operations, and project search.
- [x] Integrate CodeMirror 6 with Yjs-backed local documents and durable IndexedDB persistence.
- [x] Add SQLite metadata storage, versioned migrations, preferences, and derived indexes.
- [x] Implement the serialized filesystem bridge, known-write suppression, revision acknowledgment, and external-edit reconciliation.
- [x] Handle rename, deletion, non-ASCII paths, atomic saves, and reopen divergence.
- [x] Preserve caret/selections and separate editor undo from project recovery.
- [x] Persist recoverable baselines independently of Git.

**Verification:** Use multi-file synthetic projects. Exercise overlapping human/external changes, duplicate watcher events, interrupted save, service/renderer restart, and reopen with disk divergence. Confirm exports/source remain ordinary editable files.

**Exit:** A real project can be opened, edited, saved, and reopened without data loss. Newer human work is preserved or a resolvable conflict is shown. Save indicators reflect actual persistence.

**Recorded exit evidence:** 53 deterministic checks, 18 real Electron acceptance cases (including later fuzzy search/highlighting regressions), unpacked Linux open/edit/save smoke, reference/smaller-window screenshots, UI/design checks, GPT-6-Luna medium review/fixes and GPT-6.1 Terra UX/Phase 2 audit with independent focused runtime checks. See [project_status.md](project_status.md), [testing](docs/phase-2-testing.md) and [review](docs/phase-2-review.md). Native picker selections and one preference failure are simulated boundaries; process/SQLite/IndexedDB/editor/disk checks are real. Git cloning remains Phase 7; installed-package/performance/IME/cross-platform acceptance remains Phase 8.

## Phase 3 — Complete LaTeX and PDF workflow

**PRD coverage:** FR-02, FR-03, FR-04; initial FR-12 PDF export.

**Prerequisites:** Phase 2 complete.

- [x] Detect installed TeX tools, engines, latexmk and BibTeX/Biber; add guided missing-tool setup.
- [x] Store portable build settings separately from machine executable paths.
- [x] Connect TexLab over LSP for supported completion, diagnostics and navigation.
- [x] Implement root selection, single-project build scheduling, coalescing, cancellation, clean rebuild, and log/error display.
- [x] Associate builds with snapshots/revisions and preserve source-path mappings.
- [x] Integrate PDF.js worker, bounded page rendering, zoom, page navigation, selection, and export.
- [x] Implement forward/reverse SyncTeX where mapping exists; preserve position and identify stale output.
- [x] Connect outline, labels, citations and figure locations where resolvable.
- [x] Provide a plain-language first-use PDF flow, one-click editable samples, progressive advanced settings and contextual recovery for nontechnical researchers.

**Verification:** Build representative pdfLaTeX, XeLaTeX, LuaLaTeX, and Biber/BibTeX projects when those tools are available. Exercise missing dependencies, an ambiguous root, compile failure/cancellation, rapid edits, stale output, and mapping from snapshot paths. Clearly list unavailable live tool checks.

**Exit:** The author can edit, compile, inspect, navigate, and export a multi-file paper. A failed build retains identifiable last-successful output, and unavailable mappings produce useful fallbacks.

**Recorded exit evidence:** 82 deterministic checks, 19 default Electron regression/missing-tool cases, eight real native TeX/TexLab checks, nine live Electron LaTeX/PDF scenarios, actual process cancellation/utility interruption/no-orphan verification, packaged sandboxed render/map/export smoke, Prism/narrow inspection, strict UI/DESIGN checks and iterative GPT-6.1 Terra review. Six synthetic sample folders, built-in editable sample actions and an isolated launcher are provided. The researcher UX correction and targeted Terra review are recorded in [the UX review](docs/phase-3-ux-review.md). Independent review's one app-startup failure and successful focused rerun are explicitly recorded. See [status](project_status.md), [testing](docs/phase-3-testing.md) and [review](docs/phase-3-review.md). Installed/cross-platform/performance acceptance remains Phase 8.

## Phase 4 — Selectable agent harnesses and safe change review

**PRD coverage:** FR-05, FR-06, FR-07.

**Prerequisites:** Phases 2–3 complete.

- [x] Define the harness adapter/capability/event contract and implement OpenCode through its structured server/SDK and Codex through its native app-server (user scope decision, 4 November 2026).
- [x] Detect installation/version/authentication state and provide setup/connect/disconnect/reconnect flows.
- [x] Manage private local endpoints and distinguish Loom-owned from user-owned processes.
- [x] Support sessions, model selection, relevant manuscript context, attachments, streaming, cancellation, questions, and permission prompts.
- [x] Expose appropriate Loom project/build tools through a supported integration surface.
- [x] Capture pre-turn baselines and group native agent writes by change set.
- [x] Show direct edits, diffs, keep/revert controls, and truthful post-write review semantics.
- [x] Preserve newer edits and partial multi-file work across cancellation/failure/reconnect.
- [x] Persist session references and expose project chats through the reference UI.

**Verification:** Cover adapter events with fixtures and perform a live authorized OpenCode smoke check when available. Inspect project context, questions/permissions, tool execution, cancellation, reconnect, agent/human overlapping edits, partial writes, and safe revert. Do not equate a mock response with a live integration.

**Exit:** An author completes a project-aware agent revision, sees the changes without copy/paste, compiles, reviews, and recovers safely. No custom model/tool execution loop has been introduced.

**Recorded evidence:** [Phase 4 final acceptance](project_status.md#phase-4-final-acceptance--4-november-2026), [setup/testing](docs/phase-4-testing.md), and [review/research](docs/phase-4-review.md).

## Phase 5 — Literature, bibliography, and Zotero

**PRD coverage:** FR-08 and FR-09.

**Prerequisites:** Phases 2–4 complete.

- [ ] Parse/index bibliography records while preserving original and unknown fields.
- [ ] Search local bibliography by metadata/key/DOI and show missing/duplicate/incomplete/unused record states.
- [ ] Add arXiv search with provenance, metadata, identifiers, source links, cancellation and failure handling.
- [ ] Support manuscript-context queries and inspectable supporting abstracts/passages where available.
- [ ] Implement supported read/search Zotero connection and explicit record import.
- [ ] Preview entries and resolve key/identifier collisions before grouped citation+bibliography insertion.
- [ ] Let the agent revise surrounding discussion using selected sources with traceable evidence.

**Verification:** Use provider fixtures for empty/partial/rate-limited/failing responses and synthetic BibTeX data. Run real-source and authorized Zotero checks when available. Validate repeated imports, duplicate detection, source links, and successful compilation with inserted citations.

**Exit:** The author can locate and inspect a source, import it, cite it, and trace the manuscript revision to evidence. Missing network/library access and abstract-only evidence are represented accurately.

## Phase 6 — Scientific content and whiteboard conversion

**PRD coverage:** FR-10.

**Prerequisites:** Phase 4 complete; Phase 5 required for citation-related operations.

- [ ] Support image attachment/paste with capability detection and model-switch guidance.
- [ ] Convert supported equations and simple diagrams into editable LaTeX/TikZ with original-image comparison and uncertainty correction.
- [ ] Support contextual equation/notation refactoring and table/figure/caption/label source assistance.
- [ ] Preserve existing assets and use project-relative paths for new content.
- [ ] Route edits through the same recovery/reconciliation path and inspect compiled results.
- [ ] Distinguish requested computations actually executed by the harness from unexecuted reasoning.

**Verification:** Use representative synthetic images, an image-capable live setup when authorized, and an unsupported-model case. Inspect notation changes, asset preservation, editable output, labels, paths, build results, and recovery. Record capability-dependent limits.

**Exit:** Supported image/scientific-content workflows produce editable, inspectable manuscript changes and a compilable example. The UI does not imply that successful compilation proves scientific correctness.

## Phase 7 — Git collaboration and publication export

**PRD coverage:** FR-11 and FR-12.

**Prerequisites:** Phases 2–4 complete; Phase 5 for bibliography preflight.

- [ ] Add repository/branch/status detection, native Git credential guidance, and clone flow.
- [ ] Implement diff review, selective staging, commit, fetch, pull, push, and branch workflows.
- [ ] Coordinate pending document writes and agent activity around working-tree mutations.
- [ ] Reconcile Git changes into the live model and present conflicts with preserved inputs.
- [ ] Add portable source ZIP/PDF export, stale-PDF identification, and build/reference/asset preflight.
- [ ] Exclude credentials, private chats, machine state and disposable outputs from default exports/commits.

**Verification:** Use two local clones and a local bare remote for deterministic exchange/conflict checks. Verify authorized GitHub connectivity separately. Extract an exported project and build it with a documented compatible local toolchain.

**Exit:** Separate authors can exchange revisions asynchronously, resolve conflicts, and export a portable submission bundle without silent source loss or accidental private-state publication.

## Phase 8 — First-release hardening and Linux pilot

**PRD coverage:** FR-01–FR-13, quality Section 10, acceptance Section 12.

**Prerequisites:** All preceding feature exits satisfied.

- [ ] Complete first-run dependency guidance and all empty/loading/error/interruption states.
- [ ] Exercise every first-release acceptance scenario in PRD Section 12 and record evidence.
- [ ] Run the documented large-project workload; report packaged startup, typing, navigation, search, CPU, and memory growth against proposed targets.
- [ ] Verify restart recovery, migrations, permission behavior, credential/log/export boundaries, Unicode/IME, and paths with spaces.
- [ ] Compare default and expanded feature states with DESIGN.md; check keyboard access and smaller-window behavior.
- [ ] Produce and install a Linux x86_64 package; exercise tools and resources from the installed app, not only the dev server.
- [ ] Document supported harness/tool versions, known limitations, install/run instructions, and platform support actually verified.
- [ ] Prepare the pilot artifact and record release evidence in project_status.md. Publish artifacts only when authorized.

**Exit:** All required acceptance checks have evidence, critical data-loss/recovery defects are resolved, and the installed package completes the end-to-end research workflow. Performance exceptions and unavailable provider checks are explicit release decisions, never assumed passes.

## Requirement coverage

| Requirement                        | Principal phases |
| ---------------------------------- | ---------------- |
| FR-01 Projects                     | 1, 2, 7          |
| FR-02 Source editing and structure | 1, 2, 3          |
| FR-03 Toolchain and builds         | 3                |
| FR-04 PDF and source navigation    | 3                |
| FR-05 Harness                      | 4                |
| FR-06 Scientific conversations     | 4                |
| FR-07 Direct edits/recovery        | 2, 4             |
| FR-08 Literature                   | 5                |
| FR-09 Bibliography/Zotero          | 5                |
| FR-10 Scientific content/images    | 6                |
| FR-11 Git                          | 7                |
| FR-12 Publication/export           | 3, 7             |
| FR-13 Preferences/state            | 1, 2, 8          |

Phase 8 verifies the whole first build. Future cloud and platform-expansion work is intentionally absent from this execution plan; refer to PRD Section 9 for compatibility requirements.
