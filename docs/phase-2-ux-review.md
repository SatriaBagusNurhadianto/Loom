# Phase 2 UX correction and independent review

The user requested a footer that stays at the sidebar bottom, native file creation, uncluttered Prism-style navigation, a cohesive workspace redesign and subtle motion. They also requested GPT-6.1 Terra review of the finished UX and Phase 2 feature coverage. The supplied sidebar and assistant screenshots are retained under `design/references/`.

## Delivered behavior

- A bounded file browser and outline scroll independently; the local workspace/settings footer stays anchored for short and long projects.
- Files and Chats remain available in real projects. Files use nested folder disclosures, quiet status icons, contextual file menus and on-demand text/path search. Root selection is in file actions; deleted-file recovery has its own dialog.
- New file opens the native save picker in the project or selected folder. Project identity, containment, symlinks and exclusive creation are enforced. Cancellation keeps the current view; success selects/focuses source, including from the compact navigator. Rejected locations remain visible in that navigator.
- One toolbar contains document tabs, save/find/navigation actions and Tools. Persistence status remains visible. A two-row assistant composer stays in the center column; unavailable agent/PDF features are described honestly.
- Hover/press/menu/dialog feedback uses the shared motion tokens, with reduced motion disabling all animations and transitions. Routine notices dismiss after five seconds with hover/focus pause.

The correction retains native-picker commit `6e1a412` and motion commit `807354c`. The completed navigation is `b7c1d17`. Stronger checks caught menu-item focus loss during observed filesystem changes (`aece76a`) and compact creation leaving a modal over the editor (`76a2f51`); both are fixed and covered. The final source-color correction is `6ea8de0`: stock light-theme tokens measured as low as 1.56:1 on black, so CodeMirror now uses the canonical dark tokens, with a rendered 4.5:1 contrast regression.

## Phase 2 gate audit

| Gate                                                                       | Current evidence                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open/create/import folders and ZIPs, preserve assets                       | Real service filesystem/ZIP cases and sandboxed Electron project create/import workflows                                                                                                                     |
| Stable IDs, Unicode/nested paths, root, file operations and search         | Service tests plus Electron create/rename/root/delete/restore/search-location workflows                                                                                                                      |
| CodeMirror, Yjs and IndexedDB live/recoverable source                      | Real editor/IndexedDB cases, including unsent human text surviving service and renderer termination with disk divergence                                                                                     |
| SQLite metadata, migration, preferences and derived index                  | Service migration/schema/index cases and actual reopen/working-state persistence checks                                                                                                                      |
| Serialized bridge, external reconciliation, atomic save and acknowledgment | Duplicate/stale/overlap/reopen/interrupted-write cases, actual external edits and matching disk acknowledgment                                                                                               |
| Caret, undo and recovery ownership                                         | Electron tab/reopen caret checks, undo/redo preserving external edits, separate deleted-file recovery                                                                                                        |
| New UX and native boundaries                                               | Long-list footer containment; folder disclosure and row/menu focus after observed external additions; picker cancel/outside/Unicode/per-folder cases; compact error/cancel/create/focus/type/save at 720×540 |

Final parent checks passed: `npm run check` (formatting, TypeScript, 41 deterministic tests, production build), `npm run test:e2e` (16 cases), `npm run package`, strict UI audit (zero findings) and DESIGN lint (zero errors/warnings). The rebuilt unpacked binary passed an isolated sandboxed open/edit/save/native-create smoke. The window manager constrained that packaged window to 720×768, exercising compact navigation. Desktop footer behavior is covered separately by the Electron suite.

Actual Electron screenshots were inspected at the reference size, 1600×1000 and 900×700: `artifacts/phase-2-ux-workspace.png`, `phase-2-ux-file-menu.png`, `phase-2-ux-small.png` and `phase-2-ux-packaged.png`.

## Terra review

The requested GPT-6.1 Terra subagent reviewed the source changes, four Electron screenshots, Prism references and Phase 2 gate coverage. It independently passed the five focused UX/native Electron cases and a temporary 900×700 nested-menu/rename/delete probe. After the two parent follow-up fixes above, Terra reviewed them and independently passed the two strengthened menu-focus and compact-creation cases. Terra also reviewed `6ea8de0`, inspected the new syntax screenshot and independently passed the contrast/compact workflow case. Its final report found no actionable issue in the reviewed scope. Temporary probes were removed; the maintained regressions remain in `tests/e2e/desktop.spec.ts`.

Native picker selections and injected write/preference failures are simulated boundaries. Electron sandboxing, editor, SQLite, IndexedDB, filesystem and process interruption paths use real components. Actual OS picker behavior across platforms, physical power loss, installed distribution and Phase 8 performance/IME coverage remain unverified. TeX/PDF, OpenCode and Git product integration retain their later phase gates.
