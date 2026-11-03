# Loom

Electron workspace for scientific LaTeX writing. Phases 1–3 provide ordinary folder/ZIP projects, CodeMirror/Yjs source, durable recovery, local TeX compilation, TexLab language features and a real synchronized PDF viewer on the exercised Linux desktop target. See project_status.md for recorded verification and limits.

Open or create a project from the workspace, edit source, and use **Save** or Ctrl S. Files remain standard `.tex`, `.bib` and assets. Choose **Create PDF** or **Update PDF** to preview your writing, and **Download PDF** to share it. **Tools → PDF settings** has automatic updates and progressively disclosed advanced settings, setup help and diagnostics. **Try a sample paper** opens an editable paper and creates its PDF without finding a folder. PDF export is available; OpenCode, research and Git/source-export UI remain later-phase work. A read-only example remains available for layout comparison. The Files sidebar uses folder navigation and **…** menus for rename, root selection and deletion. **+** opens the native file picker; the toolbar **Project** icon opens a compact navigator at smaller widths.

Use the sidebar search icon for fuzzy filename and text search: `mtex` finds `main.tex`, and `intrduction` finds `Introduction`. Exact matches rank first. Matching text is highlighted in results and source; selecting a result focuses its passage. Clear removes the highlights. Ctrl F retains precise CodeMirror find/replace.

Use **Preview** beside Tools to show or hide the PDF pane, including after closing it with **×**. In a small window, Preview opens PDF focus mode; use Source or the PDF close button to return. The PDF viewer supports selectable text, pages, zoom, source navigation and native export. A failed build keeps the last successful PDF, clearly identified when older. See [the Phase 3 guide](docs/phase-3-testing.md) for the full workflow.

## Run it

Linux x86_64 is the first validated target. Use Node.js 22.12+, 24, or 26+ (supported Vitest branches) and npm 11.19.0; this implementation was checked with Node 26.7.0 and npm 11.19.0. A graphical desktop and Electron's system libraries are required. No TeX installation, account, or provider key is needed to edit local projects.

```bash
npm ci
npm run dev
```

`npm run dev` launches the **real Electron app**, with main/preload/utility services and renderer hot reload. Stop it with Ctrl C. If the shell sets `ELECTRON_RUN_AS_NODE`, use `env -u ELECTRON_RUN_AS_NODE npm run dev`. To view the same UI in a browser:

```bash
npm run dev:ui
```

Open <http://127.0.0.1:5173>. Browser preview intentionally reports the desktop service as unavailable. The real transport and recovery checks require Electron. Run one dev server at a time; both use port 5173.

## Try Phase 3

```bash
npm run try:phase3
```

This starts an isolated Electron profile. Click **Try a sample paper** (or click the current project name to open Projects first). Loom opens the introduction and creates the PDF. Edit a sentence, choose **Update PDF**, then **Download PDF**. **Projects → More sample papers** includes references, main-document selection, intentional-error and missing-package examples. Existing sample edits are preserved. The launcher can use this task's temporary verified toolchain under `/tmp/loom-phase3-tools` while it remains available; a normal installation uses your TeX/TexLab PATH. See [setup and testing](docs/phase-3-testing.md).

## Commands

| Command                    | Result                                                                          |
| -------------------------- | ------------------------------------------------------------------------------- |
| `npm ci`                   | Install exact dependencies from the lockfile                                    |
| `npm run try:phase3`       | Isolated Phase 3 workspace with editable samples and available local test tools |
| `npm run dev`              | Electron development workspace                                                  |
| `npm run dev:ui`           | Renderer browser preview on port 5173                                           |
| `npm run format`           | Format repository sources and documents                                         |
| `npm run format:check`     | Check formatting without writing                                                |
| `npm run typecheck`        | Check all TypeScript                                                            |
| `npm test`                 | Deterministic contract/lifecycle/layout/project persistence tests               |
| `npm run test:e2e`         | Real Electron acceptance checks, using isolated test preferences; build first   |
| `npm run build`            | Bundle main, preload, utility service, and renderer into `out/`                 |
| `npm start`                | Launch the previously built production workspace                                |
| `npm run check`            | Formatting, typecheck, unit tests, production build                             |
| `npm run package`          | Build unpacked Linux app at `release/linux-unpacked/loom`                       |
| `npm run package:appimage` | Build a Linux AppImage; network/download and platform prerequisites apply       |

The [Phase 3 test guide](docs/phase-3-testing.md) covers TeX/TexLab setup, builds, PDF/source navigation, export and the supplied samples. Live native/Electron checks are opt-in through `LOOM_TEST_TEX=1` with available tools. The [Phase 2 test guide](docs/phase-2-testing.md) covers projects, editing, search, persistence, conflicts and recovery. The [Phase 1 guide](docs/phase-1-testing.md) remains historical shell evidence. Generated screenshots/audits live under ignored `artifacts/`; Playwright reports live under `test-results/`.

## Ownership and local data

- `src/main`: sandboxed window lifecycle, native project dialogs and validated entry points.
- `src/preload` and `src/contracts`: named typed capabilities; renderer has no raw filesystem, shell or IPC access.
- `src/services/project`: serialized filesystem bridge, stable manifest IDs, root selection and recoverable file operations.
- `src/services/latex`: snapshot build scheduling, owned TeX/TexLab processes, diagnostics and SyncTeX.
- `src/renderer/latex`: build controls, language binding, bounded PDF.js pages and source navigation.
- `src/services/project/store.ts`: versioned SQLite metadata/checkpoints/preferences and rebuildable search index in Electron application data.
- `src/renderer/editor`: CodeMirror/Yjs binding, per-file IndexedDB recovery, selections/tabs and save acknowledgment.
- `src/renderer/workspace` and `src/renderer/ui`: Prism shell, shared controls/tokens and startup layout fallback.

Native close flushes live documents; renderer termination recovery restores the workspace in a replacement sandboxed window with a bounded retry. External overlaps retain local, baseline and disk inputs until explicitly resolved. Recovery is independent of Git and does not create commits. Deleting application data removes recovery state; ordinary project source remains in the chosen folder.

Linux x86_64 is the exercised target. Current pilot bounds: 2,000 files, 8 MiB per editable UTF-8 file, 32 MiB indexed input, 64 MiB compressed ZIP and 128 MiB expanded ZIP. Symlink paths are excluded. Project search shows up to 200 matching locations. Build snapshots are capped at 128 MiB and PDFs at 32 MiB. Explicit build settings travel in `loom.build.json`; executable discovery stays machine-local. The default recipe disables latexmk RC files and shell escape. Full performance, IME, installed-package and cross-platform checks remain Phase 8 work. The final atomic-write check does not lock independent external editors; changes are revalidated on observation.

Product scope: [PRD.md](PRD.md). Process contracts: [architecture.md](architecture.md). Visual reference and token ownership: [DESIGN.md](DESIGN.md). Execution gates: [phases.md](phases.md). Observed verification: [project_status.md](project_status.md).

Scaffold compatibility/security references: [electron-vite guide](https://electron-vite.org/guide/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), and [utility processes](https://www.electronjs.org/docs/latest/api/utility-process).
