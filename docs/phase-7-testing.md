# Phase 7 Git and publication testing

The automated coverage uses temporary synthetic manuscripts and local repositories. It does not contact a model or publish commits to a remote service.

## Automated checks

```bash
npm run check
npx playwright test tests/e2e/git.spec.ts
npm run test:e2e
npm run package
```

`tests/git-service.test.ts` uses real temporary Git repositories to check repository detection, staged/worktree diffs, untracked and deleted tracked paths, literal wildcard filenames, nested-project path mapping, selective staging, reviewed-index commits and hook changes, private/generated-path rejection, branch changes, first publication, mirror/force protection, clone, unborn unstage, and add/add plus delete/modify conflicts. `tests/source-export.test.ts` checks the preflight, ZIP contents, exclusions, expanded and incompressible compressed-size limits, warning bounds and atomic destination safety. The staged path-list test exceeds the normal subprocess output cap and confirms private paths cannot hide after truncation.

For a project nested inside a repository, a commit is rejected if the index also contains paths outside the open project. An incomplete status list also blocks commit review; reduce the changed-file list before retrying. Both sides of a staged rename are checked, and staged Git submodule references are blocked because Loom cannot review their contents, even when Git configuration or .gitmodules ignores submodules. Type changes are reported as such; symlinks remain outside the editor. A fully resolved merge with an index identical to HEAD offers explicit merge completion after review, without permitting ordinary empty commits.

The Git Electron suite runs the actual sandboxed desktop and utility service against two synthetic author clones and a local bare remote. It checks keyboard-accessible selective stage and reviewed commits, branch creation and first push, preflight warnings and path lists, a source ZIP that excludes a synthetic `.env`, clone from the initial project chooser through the native folder picker, pull/merge conflict stages, explicit ours/theirs review, editing and resolving a conflict, and push/pull exchange. When a machine LaTeX toolchain is installed, the export case extracts the ZIP and compiles it with `latexmk -norc -pdf -interaction=nonstopmode -halt-on-error -no-shell-escape`.

The app's Git integration uses native Git, its configured credential helper, or SSH agent. No Git credentials are copied into a Loom project or archive. For a read-only live access check, run `git ls-remote origin HEAD`; this confirms remote authentication and advertised refs but does not exercise a remote push. Do not use the real project remote to test push. If a live write round-trip is needed, create a disposable private repository and test branch with an authorized account, then remove the repository and branch after verification.

## Packaged smoke

After `npm run package`, use an isolated user-data directory and a disposable local Git repository with a synthetic LaTeX file. Launch `release/linux-unpacked/loom`, open the project, check repository status, stage the edit, open the staged diff, and commit through the reviewed-commit flow. Confirm the native Git log contains only the smoke commit. The recorded Phase 7 smoke exercised the packaged renderer, preload, utility process, project storage and native Git service; the native folder picker returned the synthetic project path through the Electron test harness. It did not write to the configured GitHub remote.

## Interactive local demo

Run:

```bash
npm run try:phase7
```

The command creates a unique demo folder under `.cache/phase-7-demo-*`, prepares two local author clones and a bare remote, builds Loom, and starts it with a separate profile. It prints the paths to the demo folder, `author-one`, `author-two`, and the `file://` remote. Open the printed `author-one` folder in Loom. The demo uses only synthetic manuscript text and a one-pixel figure; it never contacts GitHub. To create the fixture without launching Loom, run `node scripts/try-phase-7.mjs --prepare-only`.

Try the workflows in this order:

1. **Inspect status and private-path protection.** Refresh Git status. Review the local manuscript edit and the synthetic `.env`. Try to stage `.env` and confirm Loom blocks it. Remove only the generated `.env` and `main.aux` from the printed `author-one` folder, then refresh so Git is clean except for the manuscript edit.
2. **Review, stage, and commit.** Open the worktree diff for `main.tex`, stage only that file, inspect the staged diff, and create the reviewed commit. Confirm no push happened as a side effect.
3. **Exercise branch controls.** Create a demo branch, switch to it, then return to `main` before pulling.
4. **Exchange and resolve a conflict.** Fetch and pull. `author-two` has already pushed a competing edit to the same sentence, so the pull should surface a conflict. Review base/ours/theirs and use **Resolve using ours**. Because the chosen tree matches the just-reviewed local commit, use **Review merge completion** and **Finish merge** to complete the merge without a content delta. Push explicitly.
5. **Clone through Loom.** Paste the printed `file://` remote into **Clone an existing repository**, choose a new folder under the printed demo directory, and clone the local bare remote. This exercises the clone UI without network credentials.
6. **Check PDF freshness and export.** Build the manuscript PDF. Edit and save one sentence; confirm the PDF is marked stale, then rebuild and use **Download PDF**. For preflight warnings, temporarily add `\ref{missing:demo}` and `\cite{missing2025}`, run **Run preflight**, and inspect the warnings and included/excluded paths. The existing `\graphicspath{{figures/}}` should resolve `plot` without a false missing-figure warning. Add a synthetic `.env` and `main.aux` again to confirm they are excluded from the source ZIP, then export to a location outside the project. Extract the ZIP and, if local TeX is installed, compile its root `main.tex`.
7. **Check optional mutation coordination.** If an agent is configured, start a manuscript-writing request and try a Git working-tree mutation while the request is active. Loom should explain why the mutation is blocked; stop the agent, let recovery settle, then retry.

The demo directory is preserved when Loom exits so you can inspect both clones and the bare remote. Close Loom before removing only the printed `.cache/phase-7-demo-*` directory. Build and PDF/ZIP compilation steps need a local TeX toolchain; Git status, branch, review, exchange, conflict resolution, and cloning do not.

## Manual review

1. Open a clean ordinary LaTeX project and inspect the compact Git branch/status control. A non-repository shows a clear Git-not-initialized state.
2. Edit two files and add a synthetic `.env`. Inspect worktree diffs, stage one file, inspect the staged diff and commit it. Loom should leave the other edits unstaged and block the `.env` from staging/commit.
3. Use two clones and a bare remote. Commit/push one revision from each clone, fetch/pull into the other, then make overlapping edits to one file. Loom should preserve both conflict stages and require an explicit resolution before the conflict can be committed.
4. Run publication preflight. Inspect every included/excluded path, unresolved literal reference/bibliography/asset warning, current build revision and stale PDF indicator. Export to a location outside the project.
5. Extract the ZIP to a new folder and build its root document using the compatible local LaTeX tools shown in PDF settings. Confirm local `.cls`, `.sty`, `.bib`, configuration and assets needed by the manuscript are present.

## Limits

Preflight recognizes literal graphicspath directories for figure lookup, and rejects included paths that collide under lowercase comparison or Unicode normalization (including directory components). It is a static literal-syntax check, not a complete TeX dependency resolver, scientific review, secret scanner or publisher acceptance check. Inspect the included files before sharing. Common disposable compiler outputs and known private application folders are excluded by default. A failed Git clone may leave a partial destination; inspect or remove that folder before retrying. Dirty worktrees block pull and branch switches; Loom never stashes/discards work. Live GitHub read access is separate from a local two-author exchange, and no remote push is performed by the automated suite. Git hooks remain native behavior and can alter a commit after index review; Loom reports a changed resulting tree so the author can inspect it.

If source preflight succeeds but PDF/build status is unavailable or invalid, the Git dialog marks preflight incomplete and offers a retry through Refresh preflight. Source export remains available; the warning does not claim PDF freshness.

The archive regression extracts a synthetic root `__proto__` file and checks its bytes using the streaming ZIP reader; portable filenames that match JavaScript object properties remain ordinary archive entries.
