# Phase 6 testing

Use an isolated synthetic paper and `npm run check` / `npm run test:e2e` for deterministic and Electron coverage. Picker choices, clipboard data and the agent server in Electron tests are synthetic; real filesystem, editor, service and local build boundaries are exercised. See [project status](../project_status.md) for the observed runs and limits.

Attach or paste a supported image, choose an image-capable model, and send a request. Unsupported models retain the draft and explain model selection. The image is saved in the paper; its submitted copy is available from the time-labeled comparison action even if the current file changes. Zoom and scroll the preview or use Expand for fine details; Escape closes the larger view. Review the interpretation and ask for corrections before accepting the source. A successful build does not verify its scientific meaning.

In Workspace tools, the image, notation and table/figure starters append editable text without sending it. Review changed files in Merge Changes; a conflicting newer author edit must not be silently overwritten by Undo. Use the PDF/build status to inspect the compiled revision, not as evidence of mathematical equivalence.

The opt-in tests below require an authorized working Codex installation and model, and a local TeX toolchain. They create temporary synthetic projects and do not approve unexpected native prompts. Results depend on the connected model and do not guarantee compliant interpretation on every request.

```bash
LOOM_IMAGE_WORKFLOW=1 npx vitest run tests/agent-image-workflow-live.test.ts
LOOM_DIAGRAM_WORKFLOW=1 npx vitest run tests/agent-diagram-workflow-live.test.ts
LOOM_SCIENCE_WORKFLOW=1 npx vitest run tests/agent-science-workflow-live.test.ts
```

Native command details show the command and harness-reported output separately from assistant prose. A shell command can read scripts, data or other inputs that are not captured in this view; model-reported inputs are not independently verified. Do not interpret this disclosure as complete computation provenance. Arbitrary scripts and their indirect inputs remain a Phase 6 acceptance gap.
