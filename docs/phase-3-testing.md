# Phase 3 testing

Phase 3 adds real local compilation, TexLab, PDF.js, SyncTeX and PDF export. All examples are synthetic, ordinary LaTeX folders. No account, model/provider call or Git operation is needed.

## Quick start on this machine

```bash
npm run try:phase3
```

This builds and starts the real Electron app with a separate profile in `.cache/phase-3-profile`. It copies each sample folder to `.cache/phase-3-examples` the first time; existing copies and your edits are preserved. In Loom, choose **Open or create project → Open folder**, open `.cache/phase-3-examples/multi-file`, then close the Projects dialog. Choose **Compile** in the source toolbar or **Tools → Build and LaTeX → Compile**. The PDF status button also opens Build and LaTeX.

The launcher uses your normal PATH. On this development machine it can also find the independently downloaded verification tools in `/tmp/loom-phase3-tools` (TinyTeX, TexLab and Biber's libcrypt compatibility library). It changes only the launched process environment. Those temporary tools are not bundled with Loom and may disappear after reboot; `LOOM_PHASE3_TOOLS=/path/to/tools npm run try:phase3` can point at the same directory layout elsewhere. The product never installs tools automatically.

For a normal installation, install a compatible TeX distribution, latexmk, engines, bibliography tools, SyncTeX and TexLab, then restart Loom so it inherits PATH. **Build and LaTeX → Detect tools** shows actual availability and version failures. Its installation-guide buttons open the official [LaTeX setup page](https://www.latex-project.org/get/) and [TexLab installation instructions](https://github.com/latex-lsp/texlab#installation). Manual editing works when tools are missing. Use `npm run dev` for the development workspace, or `npm run build` followed by `npm start` for the normal profile.

## Sample folders

| Folder            | What to exercise                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `multi-file`      | Three-page article, included section files, equation/section/figure labels and PNG asset; pdfLaTeX, XeLaTeX and LuaLaTeX |
| `biber`           | biblatex with Biber, a `.bib` file and portable Biber configuration                                                      |
| `bibtex`          | Traditional BibTeX sequence and portable BibTeX configuration                                                            |
| `ambiguous`       | Two possible roots. Choose one in Build and LaTeX, then Save build settings before compiling                             |
| `broken`          | Intentional undefined command; inspect a source-linked error and raw log                                                 |
| `missing-package` | Intentional nonexistent package; inspect the actionable compiler failure                                                 |

Tracked originals are under [`examples/phase-3`](../examples/phase-3). Use the launcher's copies for experiments. Bibliography metadata is invented; it does not identify real papers.

## Edit, compile, inspect and export

1. Open `multi-file`. Source/assets must remain ordinary files; merely opening the project writes no configuration into it. Choose **Compile**. Expect **Compiling…**, then **Compiled**, three selectable PDF pages and a source revision identifier. Builds live in application data, outside the manuscript.
2. Use Previous/Next, the page-number field and Zoom. Fit width adapts to the pane; larger zoom scrolls within the PDF pane. Select text in the PDF and copy it. One page/canvas/text layer is mounted at a time, with an eight-million-pixel render budget. Repeated page/zoom changes must not accumulate canvases or show old renders.
3. Double-click a passage on PDF page 1 to open `sections/introduction.tex`. Place the source caret on ordinary body text and choose **Tools → Show in PDF**. **Show source** provides a keyboard-accessible reverse action from the last clicked passage or the center of the visible page. Mapping uses the displayed build's snapshot. Preamble commands, images and some custom macros may not have a resolvable location; an unavailable-mapping message is expected.
4. Open **Project structure** in the sidebar outline. Navigate sections, labels, figure source locations and bibliography keys across files. The active-file outline stays immediate. In source, place the caret in a `\\ref{...}` or `\\cite{...}` argument and use **F12** / **Tools → Go to definition**. Use **Ctrl Space** / **Complete at cursor** for TexLab's supported completions, for example inside `\\ref{sec:i...}`. TexLab supplies language intelligence; arbitrary custom macros may remain unresolved. Its lint gutter/hover messages explicitly identify diagnostics without a server revision.
5. Edit while a build runs. Editing/saving must stay responsive. **PDF out of date** appears as soon as local work differs. Recompile to map current source; stale mappings are blocked with a useful explanation. Existing PDF pages remain readable while compiling.
6. Put `\\LoomUndefinedCommand` **inside the document before `\\end{document}`**, then compile. Expect **Build failed**, a bounded raw log/source-linked error, and the last successful PDF still available and identified as older. Clicking an error opens its source. Fix the command and use **Clean rebuild**. The PDF should become current and retain its page/zoom/reading position where possible.
7. Choose **Export compiled PDF**. The native save dialog exports the retained successful artifact. Older source produces an explicit older-PDF dialog title and filename. Cancellation creates no file. Export never rewrites manuscript source.
8. Resize to 900×700 and 720×540. Use **Preview**, **Source/PDF**, **Return to workspace** and the close button; source text/caret and PDF reading position should remain usable. Check Tab/Shift Tab, Escape, F6 and native selects. The assistant stays at the bottom of the center column and remains disconnected until Phase 4.

## Settings, scheduling and failures

- **Save build settings** explicitly writes `loom.build.json` with schema version, root, engine, bibliography choice, latexmk recipe and auto-build/delay. Copy the folder and reopen with a new profile: those choices must survive. Executable paths are not in this file. The fixed recipe disables latexmk RC files and shell escape; projects depending on custom executable recipes need adaptation.
- For the engine check, save each of pdfLaTeX, XeLaTeX and LuaLaTeX in `multi-file`, then Compile. For bibliography, build the `biber` and `bibtex` samples and inspect the log for the actual tool sequence. An incompatible explicit backend selection must produce guidance. Versions describe the observed build, not a frozen reproducible environment.
- Enable **Compile after editing settles**, save, then edit several times. Expect one scheduled build and at most one consolidated follow-up. **Cancel build** drops pending intent and terminates the owned native group; existing successful output remains. **Clean rebuild** starts from fresh snapshot outputs without deleting the retained successful mapping first.
- Open `ambiguous`. Compilation requests a root rather than guessing. Opening `missing-package` fails with the package name in the log; install actual missing dependencies using your distribution, not the intentionally nonexistent sample package.
- Change an included file or binary asset externally. The next observation marks the PDF older. An overlap must go through the existing Phase 2 conflict review before building. Try a project path with spaces/non-ASCII characters; forward/reverse paths must resolve back to the original project.
- Restart the local service from **Tools → Inspect desktop service**. A running build becomes interrupted; the retained successful artifact and mapping survive. A late response must not be applied to another project. The supervisor owns compilation/TexLab processes; abrupt utility termination must not leave a build running in the background.

## Automated checks

```bash
npm run check
npm run test:e2e
npm run package
```

Default deterministic tests cover contracts, project recovery and simulated native-process scheduling/failures. Default Electron tests exercise the missing-tool workflow when the optional live test toolchain is not enabled. Native picker return values are stubbed; Electron/preload/service/SQLite/IndexedDB/CodeMirror/disk and PDF.js paths are real. Run app suites sequentially on a shared desktop to avoid focus interference.

With an available authorized local TeX/TexLab setup:

```bash
LOOM_TEST_TEX=1 npm test -- tests/latex-live.test.ts
LOOM_TEST_TEX=1 npm run test:e2e -- tests/e2e/latex.spec.ts
```

The explicit live flag does not install dependencies. Put the compatible tools on PATH first. This task's temporary setup uses:

```bash
PATH="/tmp/loom-phase3-tools/.TinyTeX/bin/x86_64-linux:/tmp/loom-phase3-tools/texlab:$PATH" \
LD_LIBRARY_PATH="/tmp/loom-phase3-tools/compat/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
LOOM_TEST_TEX=1 npm test -- tests/latex-live.test.ts
```

Use the same environment prefix for the live Electron command. Live checks cover the actual three engines, Biber/BibTeX, PDF.js worker/text/selection, SyncTeX, export, failure/stale retention, settings/automatic builds and TexLab language features. Simulated cancellation/coalescing checks remain distinguished from live TeX checks. See [project_status.md](../project_status.md) and [phase-3-review.md](phase-3-review.md) for exact recorded results.

## Limits

Linux x86_64 is the exercised target. PDF input is capped at 32 MiB and snapshots at 128 MiB; Phase 2 project limits still apply. This is local TeX execution with restrictive settings, not an OS sandbox for arbitrary manuscripts. Cross-platform process trees, installed AppImages, full performance/IME/large-document acceptance and the remaining research/agent/Git workflows belong to later phases. A project-specific class/package/font can still require setup. TexLab's unversioned diagnostics are advisory against current text; compiler diagnostics remain tied to their build snapshot.
