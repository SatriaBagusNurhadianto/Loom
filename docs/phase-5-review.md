# Phase 5 review

The user requested GPT-6.1 Terra at medium reasoning effort to review correctness, bugs and UI/UX consistency. A dedicated read-only Terra subagent reviewed the requirements, implementation and actual desktop/small-window screenshots across four follow-up review rounds. The parent implemented fixes; the reviewer independently ran the research tests.

## Findings and responses

- **Main-document bibliography membership:** replaced all-file declaration matching with a shared literal dependency graph rooted at the selected main document. Normalize `./` resource paths; reject absolute/escaping paths and disconnected sources. Return declared missing resource paths to the UI, including while editing included chapters. Regression tests cover graph membership and undeclared imports.
- **Recovery dead end:** expose saved before/planned/current content and full-version copy actions. Retain idempotent Finish/Undo with whole-group baseline checks. Add an explicitly reviewed Keep current files choice that preserves newer files and archives the journal. Tests cover interruption, undo, overlapping writing and release without overwriting newer source.
- **Duplicate inconsistency:** move pure bibliography/identity logic to `domain/bibliography.ts`, used by renderer and service. Normalize Unicode letters/numbers; never equate unrelated non-Latin titles. Classify eprint as arXiv only with a supported declaration and identifier syntax. Distinguish definitive identity from possible title matches; expose existing authors/year/key/DOI and same-source/different-source choices. Definitive identity takes priority after a distinct same-title import. The final repeated-import regression preserves one entry and reuses the imported key.
- **Cancellation race:** guard dispatch after the renderer save queue and register the service AbortController before entering the project queue. Both delayed renderer operations and delayed utility project checks have cancellation tests proving no remote request is sent.
- **Unhandled response limits:** validate/bound records and warnings with explicit omitted-record notices; use a following catch around response validation. Oversized metadata is disclosed without rewriting original files or crashing the service.
- **Polling reset:** actual Electron checks found reference selection disappearing when project snapshots refreshed. A stable project/open memo now owns dialog initialization, preserving the selected preview and controls during normal polling.
- **Shared control behavior:** IconButton explicitly uses `type="button"` so clear/cancel helpers do not accidentally submit search forms. References uses canonical form-select styling and native OS popups. Wide and 720×540 screenshots retain shared layout/theme; actions are reachable through the modal scroller.

## Final reviewer result

Terra confirmed that definitive identity now wins over title-only candidates and independently passed `npx vitest run tests/research.test.ts` (19/19). Its final targeted review found no further actionable defect. This is scoped evidence, not a guarantee that every platform or manuscript syntax is covered. Runtime and live-source verification are recorded separately in [project status](../project_status.md).

A final T3-owned delegation explicitly selected provider `codex`, model `gpt-6.1-terra`, reasoning `medium`. It inspected the current implementation, requirements, prior responses and desktop/small-window screenshots and reported no additional actionable correctness or UI/UX blocker. That pass was read-only and did not rerun tests or verify an actual Zotero desktop library.
