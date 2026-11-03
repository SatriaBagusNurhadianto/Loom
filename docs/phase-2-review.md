# Phase 2 independent review

The user requested GPT-6-Luna at medium reasoning. All four delegated review rounds used the live Codex provider model `gpt-6-luna` with `reasoningEffort: medium`. Each round was a new T3-owned child task in the shared checkout; reviewers did not edit or commit implementation files.

## Findings and responses

| Round | Finding                                                | Response and evidence                                                                                                                                                                         |
| ----- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Empty second modal intercepted project picker actions  | Exclusive workspace dialog conditions and unique modal title IDs. Real picker-boundary Electron tests pass.                                                                                   |
| 1     | Polling could observe disk before unsent renderer text | Flush pending updates; carry acknowledged baseline/submitted text; retain dirty replicas across stale responses. Unit stale-replica test and real overlap/IndexedDB-only recovery tests pass. |
| 1     | Restart left service without an active project         | Reopen current metadata and flush recovered replicas on readiness. Real restart/edit/save test passes.                                                                                        |
| 1     | Caret/selection/scroll lost on tab changes             | Per-file working-state preferences and persistent live Yjs/undo ownership. Tab and full-close/reopen acceptance tests pass.                                                                   |
| 1     | Find/replace not fully exposed                         | Explicit CodeMirror search extension and visible action; replacement and save checked in Electron.                                                                                            |
| 1     | Derived index absent                                   | SQLite schema v2 rebuildable file/content index; migration and rebuild tests pass.                                                                                                            |
| 1     | Full project text/Yjs payloads in every snapshot       | On-demand load command; snapshots carry at most one requested document payload and bounded manifest. Aggregate indexing input capped; payload test passes.                                    |
| 2     | Search filtered files without line locations           | Bounded path/line/snippet/offset hits, clear/IME/stale handling and click navigation. Electron search-location test passes.                                                                   |
| 3     | Native close ignored preference-save failure           | Require preference acknowledgment before close or project switch. Simulated main-IPC persistence failure keeps the real native window open with visible error.                                |

Round 2 confirmed the seven original issues addressed. Round 3 found no further blocker in search or text recovery, and identified the preference failure above. Round 4 confirmed the close/project-switch preference guard and found no additional actionable blocker in the reviewed paths. It was a source review and did not rerun the broad Electron suite. The parent’s final 40 deterministic checks, 11 Electron cases and final package smoke passed; exact scope is recorded in [project_status.md](../project_status.md).

## Verification scope

Round 1 independently ran 31 deterministic tests, typecheck, build and the then-current six Electron cases; four old cases passed and two new project cases exposed the modal defect. Round 2 reran deterministic/type checks but avoided concurrent Electron output. Round 3 ran typecheck and whitespace checks and statically inspected search/close behavior. Review reports distinguish their own execution from parent-provided evidence.

Parent verification covers the final complete suite, package smoke, screenshots and audit outputs recorded in the status document. Picker results are stubbed to select synthetic folders; actual preload, utility process, SQLite, IndexedDB, CodeMirror and filesystem I/O run normally. The preference error case is a simulated boundary failure, not physical disk exhaustion. No live TeX, OpenCode or product Git integration is claimed.

Task request IDs: `loom-phase2-luna-review-1`, `loom-phase2-luna-review-2`, `loom-phase2-luna-review-3`, `loom-phase2-luna-review-4`.

The subsequent navigation/native-file UX correction has its own [GPT-6.1 Terra review and current regression evidence](phase-2-ux-review.md). The counts above describe the original Phase 2 completion.
