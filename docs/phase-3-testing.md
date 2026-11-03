# Phase 3 testing

Phase 3 adds real local compilation, TexLab, PDF.js, SyncTeX and PDF export. All examples are synthetic, ordinary LaTeX folders. No account, model/provider call or Git operation is needed.

## Start here: a five-minute paper walkthrough

1. From the Loom repository, run `npm run try:phase3`.
2. Click **Try a sample paper**. If another project is already open, click its name at the upper left to open **Projects**, then choose **Try a sample paper**. There is no folder to find and no settings to choose.
3. Wait for **PDF ready**. Loom opens an editable introduction and creates a three-page PDF. If local LaTeX is missing, the preview explains setup; your writing remains editable.
4. Change a few words in the introduction. Choose **Update PDF** above the editor. Your revised text should appear in the PDF. **Changes not in PDF** means you have edits waiting to be included.
5. Try the page arrows, select/copy PDF text, and double-click a sentence in the PDF to return to its source.
6. Choose **Download PDF** (the down-arrow in the PDF header), pick a destination and open the saved file.

That is the everyday workflow. You do not need to choose an engine, bibliography tool or root file for this sample. Reopening a sample preserves your edits. At a smaller window, use **Preview** to see the PDF and **Source** to return to writing.

## Try the recovery flows, if useful

Open **Projects → More sample papers**. Choose **Practice fixing an error**: the preview explains that a line needs attention. **Go to problem** opens the source; remove `\LoomUndefinedCommand`, then choose **Create PDF**. **Missing package example** intentionally cannot build: the explanation distinguishes a template's local style file from an installed package. Do not try to install its invented package.

**Choose between two papers** asks which main document you want. Choose `first.tex` and **Create PDF**; choosing the file and creating the PDF is one action, with no separate settings-save step.

For reference processing, choose **Paper with references** or **Another reference format**. Their configured bibliography tools run automatically. You can inspect the rendered references without changing compiler settings.

## Your own paper and settings

Use **Projects → Open folder** and choose the folder containing your paper's main file and its sections/images, not a collection above it. The picker closes after success. Choose **Create PDF**. When several papers are found, **Choose main document** asks you to select one.

If you open a folder above a nested paper and its included file cannot be found, Loom names the file and offers **Open paper folder**. It saves your edits and opens the selected main document's folder explicitly. Existing projects that intentionally resolve files from the parent keep their working directory unless you choose this action.

Click the PDF status in the preview header, or **Tools → PDF settings**, for **Update the PDF as I write**. Enable it and choose **Save changes**. **Advanced settings** contains the engine, references backend, main document and pause in seconds. The defaults work for most papers. Changed choices are also saved when you choose **Create PDF** or **Update PDF** in that dialog.

**Technical details** contains the complete LaTeX log, all source-linked diagnostics, recorded tool versions and **Rebuild from scratch**. **Tools and setup** has installation help and **Check again**; optional writing assistance is separate from PDF creation.

## Tool setup and launcher behavior

The launcher builds and starts the real Electron app with a separate profile in `.cache/phase-3-profile`. It also prepares the older folder-based copies in `.cache/phase-3-examples` for developer checks; the built-in sample buttons do not require them. Samples opened inside Loom are copied to that profile's `sample-papers` directory. Both preserve existing copies and edits.

On this development machine the launcher can find the independently downloaded tools in `/tmp/loom-phase3-tools` (TinyTeX, TexLab and Biber's libcrypt compatibility library). They are not bundled with Loom and may disappear after reboot. `LOOM_PHASE3_TOOLS=/path/to/tools npm run try:phase3` can point at the same directory layout elsewhere.

For a normal installation, follow the official [LaTeX setup page](https://www.latex-project.org/get/) to install a distribution with latexmk and your required engine/reference tools. Quit and reopen Loom, then choose **PDF settings → Tools and setup → Check again**. The [TexLab installation guide](https://github.com/latex-lsp/texlab#installation) covers optional completion and source navigation. Loom does not install tools automatically. `npm run dev` launches the normal development profile.

## Sample folders

| Folder            | What to exercise                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `multi-file`      | Three-page article, included section files, equation/section/figure labels and PNG asset; pdfLaTeX, XeLaTeX and LuaLaTeX |
| `biber`           | biblatex with Biber, a `.bib` file and portable Biber configuration                                                      |
| `bibtex`          | Traditional BibTeX sequence and portable BibTeX configuration                                                            |
| `ambiguous`       | Two possible roots. Choose one in PDF settings, then Save changes before compiling                                       |
| `broken`          | Intentional undefined command; inspect a source-linked error and raw log                                                 |
| `missing-package` | Intentional nonexistent package; inspect the actionable compiler failure                                                 |

Tracked originals are under [`examples/phase-3`](../examples/phase-3). Use the launcher's copies for experiments. Bibliography metadata is invented; it does not identify real papers.

## Optional detailed regression checklist

1. Open `multi-file`. Source/assets must remain ordinary files; merely opening the project writes no configuration into it. Choose **Create PDF** / **Update PDF**. Expect **Creating PDF…**, then **PDF ready**, three selectable PDF pages and a plain freshness status. Builds live in application data, outside the manuscript.
2. Use Previous/Next, the page-number field and Zoom. Fit width adapts to the pane; larger zoom scrolls within the PDF pane. Select text in the PDF and copy it. One page/canvas/text layer is mounted at a time, with an eight-million-pixel render budget. Repeated page/zoom changes must not accumulate canvases or show old renders.
3. Double-click a passage on PDF page 1 to open `sections/introduction.tex`. Place the source caret on ordinary body text and choose **Tools → Show in PDF**. **Show source** provides a keyboard-accessible reverse action from the last clicked passage or the center of the visible page. Mapping uses the displayed build's snapshot. Preamble commands, images and some custom macros may not have a resolvable location; an unavailable-mapping message is expected.
4. Open **Project structure** in the sidebar outline. Navigate sections, labels, figure source locations and bibliography keys across files. The active-file outline stays immediate. In source, place the caret in a `\ref{...}` or `\cite{...}` argument and use **F12** / **Tools → Go to definition**. Use **Ctrl Space** / **Complete at cursor** for TexLab's supported completions, for example inside `\ref{sec:i...}`. TexLab supplies language intelligence; arbitrary custom macros may remain unresolved. Its lint gutter/hover messages explicitly identify diagnostics without a server revision.
5. Edit while a build runs. Editing/saving must stay responsive. **Changes not in PDF** appears as soon as local work differs. Recompile to map current source; stale mappings are blocked with a useful explanation. Existing PDF pages remain readable while compiling.
6. Put `\LoomUndefinedCommand` **inside the document before `\end{document}`**, then compile. Expect **PDF needs attention**, a bounded raw log/source-linked error, and the last successful PDF still available and identified as older. Clicking an error opens its source. Fix the command and use **Technical details → Rebuild from scratch**. The PDF should become current and retain its page/zoom/reading position where possible.
7. Choose **Download PDF**. The native save dialog exports the retained successful artifact. Older source produces an explicit older-PDF dialog title and filename. Cancellation creates no file. Export rejects existing project inputs and symbolic-link destinations; atomic replacement preserves manuscript bytes even when an external destination was hard-linked to source.
8. Resize to 900×700 and 720×540. Use **Preview**, **Source/PDF**, **Return to workspace** and the close button; source text/caret and PDF reading position should remain usable. Check Tab/Shift Tab, Escape, F6 and native selects. The assistant stays at the bottom of the center column and remains disconnected until Phase 4.

## Settings, scheduling and failures

- **Save changes** explicitly writes `loom.build.json` with schema version, root, engine, bibliography choice, latexmk recipe and auto-build/delay. Copy the folder and reopen with a new profile: those choices must survive. Executable paths are not in this file. The fixed recipe disables latexmk RC files and shell escape; projects depending on custom executable recipes need adaptation.
- For the engine check, save each of pdfLaTeX, XeLaTeX and LuaLaTeX in `multi-file`, then create or update the PDF. For bibliography, build the `biber` and `bibtex` samples and inspect the log for the actual tool sequence. An incompatible explicit backend selection must produce guidance. Versions describe the observed build, not a frozen reproducible environment.
- Enable **Update the PDF as I write**, save, then edit several times. Expect one scheduled build and at most one consolidated follow-up. **Stop** drops pending intent and terminates the owned native group; existing successful output remains. **Technical details → Rebuild from scratch** starts from fresh snapshot outputs without deleting the retained successful mapping first.
- Open `ambiguous`. Compilation requests a root rather than guessing. Opening `missing-package` fails with the package name in the log; install actual missing dependencies using your distribution, not the intentionally nonexistent sample package.
- Change an included file or binary asset externally. The next observation marks the PDF older. An overlap must go through the existing Phase 2 conflict review before building. Try a project path with spaces/non-ASCII characters; forward/reverse paths must resolve back to the original project.
- Restart the local service from **Tools → Inspect desktop service**. A running build becomes interrupted; the retained successful artifact and mapping survive. A late response must not be applied to another project. The supervisor owns compilation/TexLab processes; abrupt utility termination must not leave a build running in the background.

## Automated checks

```bash
npm run check
npm run test:e2e
npm run package
```

Default deterministic tests cover contracts, project recovery and simulated native-process scheduling/failures, linked export destinations and interrupted PDF replacement. Default Electron tests exercise the missing-tool workflow when the optional live test toolchain is not enabled. Native picker return values are stubbed; Electron/preload/service/SQLite/IndexedDB/CodeMirror/disk and PDF.js paths are real. Run app suites sequentially on a shared desktop to avoid focus interference.

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

Use the same environment prefix for the live Electron command. Live checks cover the actual three engines, Biber/BibTeX, PDF.js worker/text/selection, SyncTeX, export, failure/stale retention, settings/automatic builds and TexLab language features. A live long-TeX case also checks cancellation, utility SIGKILL/restart and absence of orphaned build tools; simulated scheduling/failure checks remain separate. See [project_status.md](../project_status.md) and [phase-3-review.md](phase-3-review.md) for exact recorded results.

## Limits

Linux x86_64 is the exercised target. PDF input is capped at 32 MiB and snapshots at 128 MiB; Phase 2 project limits still apply. This is local TeX execution with restrictive settings, not an OS sandbox for arbitrary manuscripts. Cross-platform process trees, installed AppImages, full performance/IME/large-document acceptance and the remaining research/agent/Git workflows belong to later phases. A project-specific class/package/font can still require setup. TexLab's unversioned diagnostics are advisory against current text; compiler diagnostics remain tied to their build snapshot.
