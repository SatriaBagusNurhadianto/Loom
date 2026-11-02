# Test Phase 1 yourself

Start from the repository folder. Use `npm ci`, then `npm run dev` for the actual desktop app. You need no manuscript, TeX toolchain, account, or API key. To reset a previous layout, choose **Tools → Reset layout**.

These tests cover the Phase 1 foundation. The synthetic source and paper are read-only. No real project is created, edited, saved, or compiled.

## Workspace and visible controls

| Do this                                                                                                 | Expected output                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch `npm run dev` with a window at least 1100px wide                                                 | Charcoal Files/Chats sidebar and Outline on the left, near-black source area and composer in the center, light PDF surface on the right. Empty states explain the available work.                                                                                                           |
| Click **View workspace example**                                                                        | `main.tex` appears in Files, syntax-colored LaTeX with line numbers appears in the center, and a static white paper appears on the right. Labels say **Example · read only** and **Static layout reference · not compiled**. A dismissible notification says no project files were created. |
| Select/copy text or attempt typing in the source view                                                   | Text can be selected/copied. Typing cannot modify it; this phase has no editor.                                                                                                                                                                                                             |
| Click **Chats**, then **Files**                                                                         | Chats shows **No conversations yet** and Phase 4 availability. Files restores the example file listing.                                                                                                                                                                                     |
| Click the sidebar search icon; type `missing`                                                           | **No matching example files**, with **Clear search**.                                                                                                                                                                                                                                       |
| Click **Clear search**, then type `main`; click the search X                                            | The example appears for `main`; X immediately clears the query and returns keyboard focus to the search input. This searches only the one example filename.                                                                                                                                 |
| Click **Outline** twice                                                                                 | Section entries hide, then return; the disclosure's expanded state follows.                                                                                                                                                                                                                 |
| Click **Introduction**                                                                                  | Source focus mode opens and scrolls to the `\section{Introduction}` line. Use **Tools → Split** to return to all panels.                                                                                                                                                                    |
| Open **Tools** or the sidebar settings gear                                                             | The same shared view, panel widths, example, keyboard, and diagnostics controls appear.                                                                                                                                                                                                     |
| Click **Clear example**                                                                                 | All three panels return to empty states. A notification confirms no files were changed.                                                                                                                                                                                                     |
| Open the project selector, Add file, New chat, attachment, model, compile-status, and download controls | Each opens a specific explanation of the later phase needed. No native picker, external command, API call, or fake success occurs. **Send** remains disabled.                                                                                                                               |
| Dismiss a notification with its X                                                                       | The notification disappears; layout remains stable.                                                                                                                                                                                                                                         |

## Layout, keyboard, and persistence

| Do this                                                                                                                | Expected output                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drag either vertical divider                                                                                           | Neighboring panels resize within safe bounds; the composer stays inside the center column.                                                                                        |
| Tab to **Sidebar width** or **PDF width** divider; press ← / →                                                         | The selected width changes one percentage point per press. **Home** or double-click restores that divider's reference width.                                                      |
| In Tools, move either **Panel widths** slider with mouse or keyboard                                                   | The same width changes; no separate layout state is created.                                                                                                                      |
| Click **Collapse sidebar**, then **Restore sidebar**                                                                   | Sidebar hides and returns; the center and PDF use the available width.                                                                                                            |
| Click **Hide PDF panel**; use **Tools → Show PDF in split view**                                                       | PDF hides and returns.                                                                                                                                                            |
| Use **Tools → Source / PDF / Split**, or Ctrl Alt 1 / 2 / 3                                                            | Source-only, PDF-only, and three-column modes. Ctrl Alt B toggles the sidebar preference. On macOS, use Command instead of Ctrl; Linux is the verified target.                    |
| In PDF focus mode, Tab to **Skip to source** and press Enter                                                           | Source view opens and receives keyboard focus, including at 900×700; the example stays loaded.                                                                                    |
| Press F6 repeatedly, then Shift F6                                                                                     | Visible panel focus cycles forward/backward with a visible outline. Tab continues through their controls.                                                                         |
| Open Tools using the keyboard; press Tab / Shift Tab, then Escape                                                      | Focus stays within the modal, Escape closes it, and focus returns to the opener. Background controls do not activate through the modal.                                           |
| Resize the app to about 900×700                                                                                        | One focused panel is shown with top **Source / PDF** controls; Split is disabled with a reason in settings. No horizontal page overflow.                                          |
| In the small window select PDF, then Source; widen the app                                                             | Both focused views work. An explicitly chosen focus mode stays selected; use Split to show all panels again. If the small view was automatic from Split, widening restores Split. |
| Change widths, sidebar/PDF visibility, Files/Chats selection, outline expansion, or view mode; reload or quit/relaunch | Those presentation preferences return. The example itself is transient and must be loaded again.                                                                                  |
| Click **Reset layout**                                                                                                 | Defaults return: sidebar 30%, PDF 27%, both visible, Files selected, Outline expanded, Split mode (automatic Source focus in a narrow window).                                    |

Loom uses its own Ctrl Alt shortcuts. A desktop/window manager may intercept a shortcut; the corresponding Tools buttons remain available.

## Real desktop service and recovery

These checks require Electron, not `dev:ui`.

| Do this                                                                                                        | Expected output                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click **Service ready** below the composer, or **Tools → Inspect desktop service**                             | Connection **ready**, a positive utility-process PID, version `0.1.0`, environment **Electron desktop**.                                                |
| Click **Check connection**                                                                                     | Brief **Checking…**, then **ready** from a round trip through preload/main to the actual utility process.                                               |
| Click **Restart service**                                                                                      | A new positive utility PID and **ready**; the app remains responsive.                                                                                   |
| Copy the utility PID shown by Loom, and run `kill -TERM PID` in a terminal (replace PID with that number only) | Service becomes **unavailable** with a recovery explanation. The app, example, and layout continue working.                                             |
| Click **Restart service** after that failure                                                                   | The connection returns to **ready** with a new PID.                                                                                                     |
| On Linux, run `kill -STOP PID` for the current utility PID, then click **Check connection**                    | **Checking…** ends in about 5 seconds with a timeout explanation; no endless spinner. Restart recovers. The harness only stops the utility PID it owns. |
| Launch browser-only `npm run dev:ui`, open diagnostics                                                         | **Browser preview**, **unavailable**, and instructions to launch Electron. Restart is disabled. No simulated native success.                            |

Do not kill an unrelated PID. The utility PID is distinct from the renderer and main processes.

## Automated checks and packaging

```bash
npm run check
npm run test:e2e
npm run package
./release/linux-unpacked/loom
```

Expected: formatting, TypeScript, unit checks, and build pass; E2E opens real Electron, checks restricted renderer privileges, keyboard/layout persistence and service recovery, and writes screenshots to `artifacts/`. Packaging creates an unpacked Linux executable. Test the executable with the same workspace/service steps above; it should not need a development server.

An AppImage can also be requested with `npm run package:appimage`. Installed-package, cross-platform, performance, real project, TeX, and external-agent validation belong to later phases; an unpacked package does not prove those workflows.

## Optional saved-layout recovery check

In the browser preview, open developer tools and run:

```js
localStorage.setItem('loom.workspace-layout.v1', '{invalid');
location.reload();
```

Expected: the app opens with default layout and **Saved layout could not be read. Default layout restored.** The invalid record is replaced with valid presentation preferences; no manuscript data exists in this phase. This path and blocked/full-storage behavior also have deterministic unit checks.
