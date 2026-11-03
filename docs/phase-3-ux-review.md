# Phase 3 researcher UX correction

The user's screenshot showed a technical build-settings form and a missing included file. The audience includes researchers across disciplines with little technical experience. The revised entry point is an editable paper and a PDF; advanced compiler concepts remain available on demand.

## Diagnosis and implementation

A real TeX reproduction opened a folder containing `multi-file/main.tex` rather than `multi-file` itself. TeX searched for `sections/introduction.tex` from the parent folder and failed with the exact screenshot error. `LOOM_TEST_TEX=1 npm test -- tests/latex-live.test.ts -t 'recovers a nested'` now exercises the failure, explicit validated folder recovery and successful build. The working directory is never silently changed for existing projects.

The UI now uses Create PDF, Update PDF and Download PDF; opening a project closes the picker. A built-in sample opens its introduction and creates its PDF without a folder picker. Six sample directories are packaged; editable app-data copies are preserved on reopen. PDF settings shows a writing preference and necessary main-document choice; engine/reference/timing settings, tools and raw output are progressively disclosed. Failures share one contextual explanation and recovery action while retaining successful PDFs.

## Active GPT-6.1 Terra review

| Finding                                                         | Resolution                                                                                                             | Evidence                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Technical choices precede the first successful paper            | One-click editable sample; direct PDF actions; advanced disclosures                                                    | Real researcher sample/edit/update/download scenario                     |
| Parent folder changes relative input resolution                 | Explicit Open paper folder; native identity/save/conflict/path validation                                              | Live native and Electron reproduction/recovery                           |
| Old failure can target a newly selected main document           | Compare failed build root, source revision, engine and reference backend before offering contextual actions            | Classifier regression                                                    |
| Missing style file might belong to the template                 | Guidance acknowledges local template files and installed packages                                                      | Classifier and live missing-package sample                               |
| Opening a nested folder could lose the chosen main file         | Preserve the selected basename unless a portable configuration conflicts; require explicit choice in that case         | Multi-root native regression and real child-config recovery scenario     |
| Dismissal/shortcut/auto-build can bypass required choice        | Guard in shared LaTeX session and all visible entry points; recheck after saving; only explicit selection acknowledges | Reactive manual/auto regression and real dismiss/shortcut/toolbar checks |
| Retained-failure Retry could acknowledge the choice             | Retry focuses chooser; it never clears the requirement; rebuild remains disabled                                       | Same live child-config scenario includes an older failed build and Retry |
| Smaller screenshot captured loading rather than rendered output | Wait for PDF canvas/text readiness before capture                                                                      | Settled 900×700 screenshot and runtime assertions                        |

Terra’s final targeted source review reported no remaining actionable blocker after these fixes. The parent ran the runtime checks; this review round did not independently execute them. Settled modal and rendered small-window captures were inspected after readiness assertions.

## Design reconciliation

| Existing rule                    | Observed drift                                                 | Resolution                                                                               |
| -------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Keep manuscript and PDF central  | Technical setup dialog was the routine PDF entry               | Replace default control-panel flow with PDF actions; preserve Prism columns and composer |
| Describe the researcher's action | Snapshot hashes, milliseconds and compiler internals dominated | Plain wording, seconds under Advanced settings, raw details retained separately          |
| Controls explain the next step   | Raw missing-file/fatal errors had no folder recovery           | Shared contextual PDF guidance with explicit recovery                                    |
| Shared tokens and primitives     | No palette or typography change needed                         | Reuse Modal, native controls, buttons, status region and existing light/dark tokens      |

Native picker results are stubbed in automated checks; actual Electron, utility process, CodeMirror/Yjs, filesystem, TeX, PDF.js and export are exercised. Final counts, package smoke and limitations are recorded in [project_status.md](../project_status.md). The focused UX review does not imply cross-platform/installed-AppImage or full performance acceptance.
