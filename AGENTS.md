# Working on Loom

Loom is an Electron scientific writing workspace with a Prism-reference interface, ordinary LaTeX projects, and an external agent harness. The first release uses OpenCode and local compilation. The application has not been scaffolded yet; confirm current progress in [project_status.md](project_status.md).

## Start here

1. Read [project_status.md](project_status.md) for completed work, evidence, and the next task.
2. Read the applicable first-build phase in [phases.md](phases.md) and its prerequisite/exit criteria before implementation.
3. Read the relevant requirements in [PRD.md](PRD.md). Product scope and acceptance criteria belong there.
4. Before changing process boundaries, document persistence, builds, agent integration, or Git behavior, read the corresponding section of [architecture.md](architecture.md).
5. Before changing UI, read [DESIGN.md](DESIGN.md) and inspect [the Prism reference](design/references/prism-workspace.png). Use the frontend design skills available in the environment when applicable.

## Scope and authority

- Follow explicit user decisions. Surface genuine conflicts before changing an established product requirement.
- Keep product requirements in `PRD.md`, technical ownership/contracts in `architecture.md`, visual intent in `DESIGN.md`, execution order in `phases.md`, and observed progress in `project_status.md`.
- Treat the research brief as evidence and ideas; it does not independently expand launch scope.
- Build the first desktop release. Preserve extension boundaries for accounts and collaboration; deploy those capabilities in a later phase when authorized.
- Use OpenCode's existing execution loop, authentication, and supported models. Loom supplies the interface, integration, and scientific tools.

## Implementation rules

- Keep Electron main small, renderer privileges narrow, and native operations behind validated typed contracts.
- Keep CPU-heavy work and blocking I/O away from the renderer/main threads. Preserve responsive editing during builds and agent streaming.
- Use one logical live document model with a versioned filesystem bridge. Reconcile agent/external/Git edits against the last synchronized baseline; preserve newer human work.
- Preserve standard `.tex`, `.bib`, and assets. Keep recoverable local work independent of Git commits and disposable indexes.
- Associate each PDF and source mapping with its build snapshot. Identify stale output accurately.
- Show actual harness permissions, capability limitations, interrupted operations, and review/revert semantics. Describe post-write review honestly.
- Keep native Git authoritative for repository state. Editing a manuscript does not authorize a commit or push.
- Use argument arrays for subprocesses and validate project-relative paths. Keep credentials out of source, logs, exports, and fixtures.
- Reuse shared UI primitives and design tokens. The assistant composer belongs at the bottom of the center column in the reference layout.
- Implement honest empty/loading/error/recovery states. Visible controls must perform their stated action or explain why it is unavailable.

## Verification and completion

- Inspect existing project scripts and configuration before choosing commands. No application install/dev/test/build commands exist until scaffolding creates them; document real commands then.
- Verify the changed workflow at its boundaries. For text persistence, cover interrupted writes and overlapping edits; for builds, cover failed/stale output; for harnesses, cover permission/cancellation/reconnect; for Git, cover dirty worktrees and conflicts.
- Keep fixtures synthetic or explicitly permitted. Run external-provider smoke checks only with an available authorized setup; do not claim live verification from mocks.
- For UI changes, inspect the running application and compare the relevant state with the reference. Check keyboard access and a smaller desktop window.
- Mark a phase complete only when every exit criterion has recorded evidence. Distinguish implementation, simulated integration checks, and live external-tool verification.
- Update `project_status.md` after meaningful work with exact changes, checks/results, limitations, and the next concrete task. Update phase checkboxes when their gates actually pass.
- Use `codex/` for new work branches unless the user specifies another name. Keep commits focused; push or publish when authorized by the task.

When reporting completion, link changed files, summarize user-visible behavior, and state verification and any remaining blockers plainly.
