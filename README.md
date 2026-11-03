# Loom

Electron workspace for scientific LaTeX writing. Phases 1–2 are complete for the exercised Linux desktop target. Phase 2 adds ordinary folder/ZIP projects, editable CodeMirror/Yjs source, durable recovery, safe local saves and external-change review.

Open or create a project from the workspace, edit source, and use **Save** or Ctrl S. Files remain standard `.tex`, `.bib` and assets. PDF compilation, OpenCode, research and Git/export UI remain later-phase work. A read-only example remains available for layout comparison. The Files sidebar uses folder navigation and **…** menus for rename, root selection and deletion. **+** opens the native file picker; the toolbar **Project** icon opens a compact navigator at smaller widths.

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

## Commands

| Command                    | Result                                                                        |
| -------------------------- | ----------------------------------------------------------------------------- |
| `npm ci`                   | Install exact dependencies from the lockfile                                  |
| `npm run dev`              | Electron development workspace                                                |
| `npm run dev:ui`           | Renderer browser preview on port 5173                                         |
| `npm run format`           | Format repository sources and documents                                       |
| `npm run format:check`     | Check formatting without writing                                              |
| `npm run typecheck`        | Check all TypeScript                                                          |
| `npm test`                 | Deterministic contract/lifecycle/layout/project persistence tests             |
| `npm run test:e2e`         | Real Electron acceptance checks, using isolated test preferences; build first |
| `npm run build`            | Bundle main, preload, utility service, and renderer into `out/`               |
| `npm start`                | Launch the previously built production workspace                              |
| `npm run check`            | Formatting, typecheck, unit tests, production build                           |
| `npm run package`          | Build unpacked Linux app at `release/linux-unpacked/loom`                     |
| `npm run package:appimage` | Build a Linux AppImage; network/download and platform prerequisites apply     |

The [Phase 2 test guide](docs/phase-2-testing.md) covers projects, editing, search, persistence, conflicts and recovery. The [Phase 1 guide](docs/phase-1-testing.md) remains historical shell evidence. Generated screenshots/audits live under ignored `artifacts/`; Playwright reports live under `test-results/`.

## Ownership and local data

- `src/main`: sandboxed window lifecycle, native project dialogs and validated entry points.
- `src/preload` and `src/contracts`: named typed capabilities; renderer has no raw filesystem, shell or IPC access.
- `src/services/project`: serialized filesystem bridge, stable manifest IDs, root selection and recoverable file operations.
- `src/services/project/store.ts`: versioned SQLite metadata/checkpoints/preferences and rebuildable search index in Electron application data.
- `src/renderer/editor`: CodeMirror/Yjs binding, per-file IndexedDB recovery, selections/tabs and save acknowledgment.
- `src/renderer/workspace` and `src/renderer/ui`: Prism shell, shared controls/tokens and startup layout fallback.

Native close flushes live documents; renderer termination recovery restores the workspace in a replacement sandboxed window with a bounded retry. External overlaps retain local, baseline and disk inputs until explicitly resolved. Recovery is independent of Git and does not create commits. Deleting application data removes recovery state; ordinary project source remains in the chosen folder.

Linux x86_64 is the exercised target. Current pilot bounds: 2,000 files, 8 MiB per editable UTF-8 file, 32 MiB indexed input, 64 MiB compressed ZIP and 128 MiB expanded ZIP. Symlink paths are excluded. Project search shows up to 200 matching locations. Full performance, IME, installed-package and cross-platform checks remain Phase 8 work. The final atomic-write check does not lock independent external editors; changes are revalidated on observation.

Product scope: [PRD.md](PRD.md). Process contracts: [architecture.md](architecture.md). Visual reference and token ownership: [DESIGN.md](DESIGN.md). Execution gates: [phases.md](phases.md). Observed verification: [project_status.md](project_status.md).

Scaffold compatibility/security references: [electron-vite guide](https://electron-vite.org/guide/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), and [utility processes](https://www.electronjs.org/docs/latest/api/utility-process).
