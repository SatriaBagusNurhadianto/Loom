# Phase 7 Git and publication testing

The automated coverage uses temporary synthetic manuscripts and local repositories. It does not contact a model or publish commits to a remote service.

## Automated checks

```bash
npm run check
npx playwright test tests/e2e/git.spec.ts
npm run test:e2e
```

`tests/git-service.test.ts` uses real temporary Git repositories to check repository detection, staged/worktree diffs, untracked paths, selective staging, exact reviewed-index commits, private-path rejection, branch changes, clone and merge-conflict resolution. `tests/source-export.test.ts` checks the preflight, ZIP contents, exclusions, limits and atomic destination safety.

The Git Electron suite runs the actual sandboxed desktop and utility service against two synthetic author clones and a local bare remote. It checks keyboard-accessible selective stage and reviewed commits, branch creation, preflight warnings and path lists, a source ZIP that excludes a synthetic `.env`, clone through the native folder picker, pull/merge conflict stages, explicit ours/theirs review, editing and resolving a conflict, and push/pull exchange. When a machine LaTeX toolchain is installed, the export case extracts the ZIP and compiles it with `latexmk -norc -pdf -interaction=nonstopmode -halt-on-error -no-shell-escape`.

The app's Git integration uses native Git, its configured credential helper, or SSH agent. No Git credentials are copied into a Loom project or archive. For a read-only live access check, run `git ls-remote origin HEAD`; this confirms remote authentication and advertised refs but does not exercise a remote push. Do not use the real project remote to test push. If a live write round-trip is needed, create a disposable private repository and test branch with an authorized account, then remove the repository and branch after verification.

## Manual review

1. Open a clean ordinary LaTeX project and inspect the compact Git branch/status control. A non-repository shows a clear Git-not-initialized state.
2. Edit two files and add a synthetic `.env`. Inspect worktree diffs, stage one file, inspect the staged diff and commit it. Loom should leave the other edits unstaged and block the `.env` from staging/commit.
3. Use two clones and a bare remote. Commit/push one revision from each clone, fetch/pull into the other, then make overlapping edits to one file. Loom should preserve both conflict stages and require an explicit resolution before the conflict can be committed.
4. Run publication preflight. Inspect every included/excluded path, unresolved literal reference/bibliography/asset warning, current build revision and stale PDF indicator. Export to a location outside the project.
5. Extract the ZIP to a new folder and build its root document using the compatible local LaTeX tools shown in PDF settings. Confirm local `.cls`, `.sty`, `.bib`, configuration and assets needed by the manuscript are present.

## Limits

The preflight is a static literal-syntax check, not a complete TeX dependency resolver, scientific review, secret scanner or publisher acceptance check. Inspect the included files before sharing. Common disposable compiler outputs and known private application folders are excluded by default. A failed Git clone may leave a partial destination; inspect or remove that folder before retrying. Dirty worktrees block pull and branch switches; Loom never stashes/discards work. Live GitHub read access is separate from a local two-author exchange, and no remote push is performed by the automated suite.
