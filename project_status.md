# Loom project status

**Updated:** 3 November 2026

**Overall:** Product/design/architecture planning is documented. Application implementation has not started.

**Current milestone:** Phase 0 complete; Phase 1 — application scaffold and Prism workspace — is ready to start.

## Repository

| Item | State |
|---|---|
| Local workspace | Documentation baseline committed and pushed; implementation has not started |
| GitHub repository | [monabji/loom](https://github.com/monabji/loom), verified private and connected as `origin` |
| Default branch | `main`, verified locally and on GitHub; local branch tracks `origin/main` |
| Application source | Not scaffolded |
| Package manager/dependency versions | To be selected and pinned during Phase 1 |
| Application install/dev/test/build commands | Not defined yet |

This file records observed progress. Use Git history and remote status for exact commit/push state rather than embedding self-referential commit hashes here.

## Completed planning work

- [x] Researcher/student pain-point investigation and source-linked opportunity brief.
- [x] Product requirements, release scope, functional acceptance criteria, and proposed performance targets.
- [x] Current Prism screenshot preserved as the primary interface reference.
- [x] Design direction distinguishing observed reference structure from proposed Loom behavior.
- [x] Agent instructions and technical architecture for the first desktop build.
- [x] Dependency-ordered first-build phases covering FR-01–FR-13.
- [x] Private GitHub repository with the initial documentation baseline pushed and verified.

## Build progress

| Phase | Status | Evidence |
|---|---|---|
| 0 — Repository/readiness | Complete | Documentation checks passed; private GitHub repository/default branch verified; baseline `6831515` matched local and remote `main` |
| 1 — Scaffold/workspace | Not started | No application package or runtime |
| 2 — Projects/persistence | Not started | Architecture and acceptance criteria only |
| 3 — LaTeX/PDF | Not started | Architecture and acceptance criteria only |
| 4 — OpenCode agent | Not started | Adapter plan only; no live integration |
| 5 — Literature/Zotero | Not started | Requirements only |
| 6 — Scientific content/images | Not started | Requirements only |
| 7 — Git/export workflows | Not started | Requirements only; development-repository setup is not product Git implementation |
| 8 — Hardening/pilot | Not started | No packaged artifact or application performance measurements |

## Current decisions

- First product: free Electron desktop workspace for scientific LaTeX writing.
- First harness: OpenCode; connect through the existing structured server/SDK.
- First validated platform: Linux x86_64 pilot, recorded as an engineering default.
- Toolchain: detect installed LaTeX tools and guide missing dependency setup.
- Interface: supplied Prism screenshot, with the assistant composer in the center column.
- Live text: Yjs with a versioned bridge to ordinary project files.
- Initial collaboration: Git/GitHub; accounts and live coediting follow later.

Decision provenance and full scope remain in [PRD.md](PRD.md), Section 1.2; this summary is for orientation.

## Verification evidence

| Check | Result |
|---|---|
| PRD structure and local reference checks | Passed during PRD creation: 13 unique functional groups and existing local references |
| DESIGN.md format check | Passed during design-reference update: zero errors/warnings; unmeasured tokens explicitly deferred |
| New planning-document links and coverage | Passed: all local Markdown references resolve; phases cover FR-01–FR-13 |
| Documentation whitespace check | Passed: staged documentation check has no findings |
| Credential-pattern scan of project text | No matching credential/private-key patterns found; this is a limited text check |
| GitHub repository creation | Verified private repository at `https://github.com/monabji/loom`; local origin connected |
| Initial commit/push verification | Passed: baseline `6831515ab167dff65d543688da6e40aee077927a` matched local HEAD and remote `main`; GitHub reports `main` as default and private visibility |
| Runtime, build, native-tool, provider, and performance checks | Not run; application does not exist yet |

## Next task

Begin Phase 1: scaffold the Electron/TypeScript/electron-vite/SolidJS application, establish typed main/preload/utility-process boundaries, and implement the reference workspace shell. Select compatible dependency versions then record real project commands.

## Blockers and limitations

- No user clarification is required to begin the first-build foundation with the defaults recorded in the PRD.
- Harness installation/provider access, TeX tools, Zotero access, and cross-platform packaging are not yet verified for product use.
- Expanded Prism conversations/menus are not shown in the screenshot; corresponding Loom states require design review as they are implemented.
- Performance figures in the PRD are targets; there are no measured application results.

## Update procedure

After meaningful implementation, update the date, phase status, evidence table, limitations, and next task. Record checks actually run and distinguish fixture-based verification from live integrations. Mark phase checkboxes only when all required evidence exists.
