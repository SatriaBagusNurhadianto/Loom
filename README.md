# Loom

Electron workspace for scientific LaTeX writing. **Phase 1 implements the application foundation and Prism-reference workspace only.** Phase 2 has not started.

The source view and paper are explicitly labeled, read-only synthetic examples. Opening/saving projects, manuscript editing, compiling real PDFs, agents, Git, and research tools are later-phase work.

## Run it

Linux x86_64 is the first validated target. Use Node.js 22.12+, 24, or 26+ (supported Vitest branches) and npm 11.19.0; this implementation was checked with Node 26.7.0 and npm 11.19.0. A graphical desktop and Electron's system libraries are required. No TeX installation, account, or provider key is needed for Phase 1.

```bash
npm ci
npm run dev
```

`npm run dev` launches the **real Electron app**, with main/preload/utility services and renderer hot reload. Stop it with Ctrl C. To view the same UI in a browser:

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
| `npm test`                 | Deterministic contract/lifecycle/layout tests                                 |
| `npm run test:e2e`         | Real Electron acceptance checks, using isolated test preferences; build first |
| `npm run build`            | Bundle main, preload, utility service, and renderer into `out/`               |
| `npm start`                | Build and launch the production workspace                                     |
| `npm run check`            | Formatting, typecheck, unit tests, production build                           |
| `npm run package`          | Build unpacked Linux app at `release/linux-unpacked/loom`                     |
| `npm run package:appimage` | Build a Linux AppImage; network/download and platform prerequisites apply     |

The [Phase 1 test guide](docs/phase-1-testing.md) lists each action and its expected result, including layout persistence and service recovery. Test screenshots and audit outputs are generated under ignored `artifacts/`; Playwright reports are under `test-results/`.

## Ownership

- `src/main`: window lifecycle and validated native entry points.
- `src/preload`: three named desktop capabilities; no generic IPC, Node, files, or shell API exposed to the renderer.
- `src/contracts`: strict runtime schemas and typed results/events.
- `src/services`: separate Electron utility process; Phase 1 implements connection diagnostics only.
- `src/renderer/workspace`: SolidJS shell and versioned presentation preferences.
- `src/renderer/ui`: shared primitives and canonical CSS tokens.

Layout preferences alone use versioned renderer local storage in Phase 1. The example is transient; reloading resets it. This does not implement the Phase 2 document model or persistence.

Product scope: [PRD.md](PRD.md). Process contracts: [architecture.md](architecture.md). Visual reference and token ownership: [DESIGN.md](DESIGN.md). Execution gates: [phases.md](phases.md). Observed verification: [project_status.md](project_status.md).

Scaffold compatibility/security references: [electron-vite guide](https://electron-vite.org/guide/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), and [utility processes](https://www.electronjs.org/docs/latest/api/utility-process).
