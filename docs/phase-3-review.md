# Phase 3 independent review

The user requested an active **GPT-6.1 Terra** reviewer during implementation and final acceptance. A native Terra child reviewed the shared checkout in successive rounds without editing files. Review scope: Phase 3 in `phases.md`, PRD FR-02/03/04 and initial PDF export, architecture boundaries, real source, fixtures, renderer states and testing instructions.

## Findings and responses

| Finding                                                                               | Implemented response                                                                                      | Evidence                                                                         |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Builds must not block the project queue or compile mutable source                     | Short checkpointed copy/recheck inside the queue; TeX runs outside it on an immutable snapshot            | Scheduler/native process tests and live editing/build checks                     |
| Explicit bibliography choice could silently use the other backend                     | Detect incompatible Biber/BibTeX source settings and produce guidance                                     | Deterministic guard checks and real Biber/BibTeX builds                          |
| A queued build after root removal could reject outside controlled handling            | Record a failed queued operation; retain successful output                                                | Native root-deletion/coalescing regression                                       |
| Build settings/root were only local metadata                                          | Explicit portable `loom.build.json`; machine executable discovery remains separate                        | Copy/new-profile checks and live settings UI                                     |
| TexLab process and unversioned diagnostics lacked honest lifecycle/revision treatment | Stdin-owned process group; server-unversioned diagnostics labeled explicitly                              | Live language checks, owned-process lifecycle and source review                  |
| Settings form reset during polling; automatic-build timers restarted on snapshots     | Stable project/settings keys, form hydration on open, revision-based debounce                             | Reactive session and real polling/auto-build checks                              |
| Old visible PDF could map through a new build; late mapping could use newer text      | Displayed-build/loading guards plus identity/freshness recheck after mapping                              | Real SyncTeX and stale-output checks                                             |
| Cancelled rendering could reuse the same active canvas                                | Each render owns its own replaceable canvas/text surface and cleanup                                      | Rapid page/zoom changes and bounded mounted-canvas check                         |
| Old structure results could overwrite new source                                      | Revision/generation check before accepting results                                                        | Reactive out-of-order regression                                                 |
| Export could overwrite source or a linked input                                       | Canonical-path/input/extension validation, symlink rejection, atomic PDF replacement and revision recheck | Native linked/interrupted export tests and real picker-boundary source rejection |
| External portable settings and inactive TexLab documents could remain stale           | Re-parse config on observation; synchronize inactive changes/additions/renames/missing paths              | External-config tests and real cross-file TexLab tests                           |
| Config cache ignored renamed/deleted roots                                            | Include root identity/path/availability in invalidation, require repair/save when missing                 | Rename/delete/repair regression                                                  |

Parent verification also found and fixed an optional-language keymap conflict with the existing redo handler, and a queued focus-mode callback that could steal focus from a subsequently opened file menu. Existing real undo/external-edit/recovery coverage passes; the keyboard menu regression passed three consecutive focused runs after the focus guard.

## Independent execution

- Terra independently ran the original six live native toolchain tests successfully: pdfLaTeX, XeLaTeX, LuaLaTeX, Biber, BibTeX and TexLab completion/definitions/diagnostics.
- Terra independently ran the five live Electron scenarios. Four passed in the full run; the cancellation case encountered an application-startup exit before its scenario began, then passed on a focused rerun (1/1). The missing-tools case was intentionally skipped under the live flag. This is **not** recorded as a clean full independent run.
- After the three confirmed integration fixes, Terra reported no additional clear blocker. A final diff pass then found configured-root cache invalidation; that finding received a focused regression/fix and follow-up inspection.
- Parent final results, package smoke and limits are recorded in [project_status.md](../project_status.md). Native picker selections are stubbed; process, editor, recovery, filesystem, TeX/LSP and PDF.js behavior are real. Fixtures are synthetic.

No live OpenCode/model/Zotero/product Git capability is implied. TeX/tool execution is local; Linux x86_64 is the exercised target. The one independent startup failure remains recorded for hardening even when focused reruns and parent acceptance pass.
