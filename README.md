# Loom

A free desktop workspace for scientific writing: edit LaTeX, inspect the PDF, work with your chosen agent harness, manage research references, and exchange revisions through Git.

**Current state:** Planning and repository setup. The Electron application has not been scaffolded and there is no runnable build yet.

## Project documents

| Document | Purpose |
|---|---|
| [PRD.md](PRD.md) | Product scope, decisions, functional requirements, quality targets, release acceptance |
| [AGENTS.md](AGENTS.md) | Instructions and context pointers for coding agents |
| [architecture.md](architecture.md) | Planned modules, process boundaries, state ownership, and integration contracts |
| [phases.md](phases.md) | Execution plan for the first desktop build only |
| [project_status.md](project_status.md) | Actual progress, verification evidence, limitations, and next task |
| [DESIGN.md](DESIGN.md) | Prism-reference layout and visual direction |
| [Research brief](research/latex-editor-opportunity-brief.md) | Qualitative user feedback and sources |

The first build uses Electron, TypeScript, SolidJS, CodeMirror 6, Yjs, PDF.js, local LaTeX tools, and OpenCode as the first harness. Accounts and live cloud collaboration are deferred.

Installation and development commands will be added after scaffolding creates and verifies them. Base application access is intended to be free; external AI providers and harness subscriptions may have their own costs. Licensing has not yet been selected.
