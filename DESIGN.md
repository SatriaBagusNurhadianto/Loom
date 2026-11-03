---
version: alpha
name: Loom
description: Prism-reference scientific writing desktop workspace.
colors:
  sidebar: '#171717'
  editor: '#050505'
  raised: '#282828'
  text: '#e8e8e8'
  muted: '#a0a0a0'
  primary: '#173a8a'
  focus: '#8f8f8f'
  paper: '#fafafa'
typography:
  ui:
    fontFamily: Arial, Helvetica, sans-serif
  source:
    fontFamily: DejaVu Sans Mono, Liberation Mono, monospace
  paper:
    fontFamily: Liberation Serif, Times New Roman, serif
rounded:
  control: 8px
  panel: 14px
  pill: 999px
spacing:
  small: 4px
  medium: 8px
  large: 16px
  section: 24px
components:
  button:
    rounded: '{rounded.control}'
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text}'
  source:
    backgroundColor: '{colors.editor}'
    textColor: '{colors.muted}'
  tools:
    backgroundColor: '{colors.primary}'
  focus:
    backgroundColor: '{colors.focus}'
  paper:
    backgroundColor: '{colors.paper}'
  dialog:
    rounded: '{rounded.panel}'
    backgroundColor: '{colors.sidebar}'
    textColor: '{colors.text}'
---

# Loom design direction

## Overview

The user explicitly requested an interface identical to OpenAI Prism, extended with Loom's capabilities. Prism is the visual and layout reference. Match its workspace arrangement and interaction density using Loom's own name and branding.

This is a product workspace for researchers writing, revising, compiling, and reviewing LaTeX manuscripts. The accepted application direction is Electron, with external agent harnesses, Git/GitHub integration, and future authentication and cloud collaboration.

Phase 1 implements the workspace shell and shared primitives. The palette and metrics below are implementation calibrations against the reference, not a claim to reproduce Prism’s original CSS. The user supplied the current Prism workspace screenshot on 3 November 2026. It is preserved at `design/references/prism-workspace.png` and is the primary visual reference. Font families, original CSS dimensions, expanded conversations, menus, and panel interactions cannot be established from the static image alone.

Reference evidence:

- Original workspace: `design/references/prism-workspace.png`.
- Newer sidebar and assistant states: `design/references/prism-sidebar.png`, `prism-assistant-expanded.png`, and `prism-assistant-empty.png`; these guide the refined navigation, narrower sidebar and two-row composer.
- Official launch page: https://openai.com/index/introducing-prism/
- Official workspace description: https://help.openai.com/en/articles/20001050-troubleshooting-prism
- The official launch illustration describes source on the left, a compiled paper on the right, and an assistant prompt in the workspace.
- Official help documents the assistant panel at the bottom of the workspace and System, Light, and Dark appearance settings.

The reference is OpenAI Prism, not unrelated products also named Prism. The screenshot supersedes earlier inferred layout descriptions. Exact runtime metrics and behaviors remain to be established.

## Colors

The supplied reference uses a charcoal sidebar and composer, a near-black source area, a white PDF pane and paper, subdued separators, and a blue Tools control. Source highlighting distinguishes commands, braces, options, strings, and comments. Preserve this theme relationship. The frontmatter records the calibrated Phase 1 palette; the runtime owner is `src/renderer/ui/tokens.css`. Distinguish editing, compilation, synchronization, and agent states with text as well as color.

## Typography

Match the selected reference's application text and source editor typography. The compiled manuscript keeps its document-defined typography. Phase 1 uses locally available UI, source, and paper font stacks from the frontmatter, with no remote font dependency. Application text is 14px (16px above 1700px); source is 13px (17px above 1700px). These are calibrated choices, not measured original Prism fonts.

## Layout

Observed default layout:

- Left sidebar: product mark and collapse control at the top; project selector and invite action; Files and Chats tabs with search/add actions; file tree; an Outline section below the files; profile and workspace controls pinned at the bottom.
- Center: open file tab and a Tools action above the source editor. The source area has line numbers and syntax highlighting. The assistant composer is anchored at the bottom of the center column, with attachment, model selection, voice, and send controls.
- Right: a light PDF surface within rounded bounds; compile status and dropdown, expand, download, and overflow controls at the top; rendered paper; a floating lower navigation control.
- Approximate screenshot width allocation: sidebar 30%, source/assistant 42%, PDF 27%, with the remainder occupied by outer insets and separators. These are observed proportions, not fixed responsive widths.

Do not place the assistant below the entire three-column workspace: in this reference its composer occupies the center column only. The Chats tab exists in the sidebar; an expanded conversation is not shown, so its placement must not be invented as observed Prism behavior.

Resizable/collapsible panels, saved layout, and narrow-window focus modes are proposed Loom behaviors rather than verified interactions from this screenshot.

Proposed placement of Loom additions, pending user discussion:

- Agent and model selection in the assistant area, with connection status and a clear connect action.
- Git branch and repository state in a compact status area; change review and commit actions open a dedicated view on demand.
- Literature and Zotero search in a contextual panel opened from citation actions or the agent conversation.
- Compiler selection and build configuration in the build controls and project settings.
- Comments, presence, and sharing alongside the manuscript when cloud collaboration becomes available.
- Separate readable indicators for local saving, cloud synchronization, build freshness, and agent activity.

Panel sizes and focus should survive routine edits and compilation. Loading and error states should preserve layout. Narrow windows should use explicit focus modes instead of squeezing every panel into view.

## Elevation & Depth

Match the reference's surface hierarchy after visual inspection. Supplementary tools should appear in contextual panels, menus, and review surfaces without obscuring the passage under review.

## Shapes

Match the reference after measurement. No alternative shape system has been approved.

## Components

Foundational components will cover project navigation, source editing, PDF navigation, assistant input and responses, agent selection, change review, bibliography search, build diagnostics, sharing, settings, and Git operations. Reuse common controls and state presentations across these surfaces.

Keyboard navigation, visible focus, accessible names, stable control sizes, and recoverable error states are required. Reference fidelity should preserve usability.

Runtime token ownership is `src/renderer/ui/tokens.css`; `workspace.css` consumes these variables. Frontmatter palette names map to `--surface-sidebar`, `--surface-editor`, `--surface-raised`, `--text-primary`, `--text-muted`, `--accent`, `--focus`, and `--pdf-surface`. Type roles map to `--font-ui`, `--font-source`, and `--font-paper`; radii map to `--radius-control`, `--radius-panel`, and `--radius-pill`. Spacing uses `--space-1/2/3/4/6` (4/8/12/16/24px). Syntax, border, status/error and scrollbar roles are defined only in that runtime source. The light PDF surface has contextual scrollbar colors.

Shared control/empty/modal ownership is `src/renderer/ui/primitives.tsx`; line icons live in `Icon.tsx`. Modal dialogs use native `<dialog>.showModal()` with browser focus containment, Escape, background inertness and explicit restoration to the opener. Search has immediate local filtering and a clear action. Sidebar Files/Chats are toggle buttons in a named group, rather than incomplete ARIA tabs. There is no select/listbox or data table in Phase 1. Global scrollbars have standard and Chromium styles, hover/active states, and a forced-colors override.

The newer supplied Prism references use a narrower sidebar. New layouts start at 20% sidebar, 48% source, 32% PDF; saved user widths are retained, with six-pixel keyboard-operable dividers. Sidebar bounds are 18–38%, PDF 22–45%, with at least 25% retained for source. Below 1100px, show Source or PDF focus mode and a compact view toolbar. Preserve split preference across automatic responsive changes. Native Electron minimum is 720×540.

The default state is honestly empty. A user-triggered synthetic example permits reference comparison without implying a real project, editor, saved file, compilation, or agent. The composer is a foundation surface with an explicit disconnected state and disabled Send. Availability dialogs explain each later-phase action. Phase 1 stored UI layout alone with a versioned, validated schema. Phase 2 real projects use the document/recovery and SQLite preferences described below; the synthetic example remains transient.

Notifications use one stable status region with a dismiss action; routine notices dismiss after five seconds, pausing while hovered or focused; errors that require recovery remain inline in diagnostics. Width sliders and divider keys provide alternatives to pointer dragging. F6 cycles visible panels. Source/PDF/Split controls and Ctrl Alt 1/2/3 provide focus modes; Ctrl Alt B toggles sidebar. Reduced motion and forced colors are handled globally. English desktop is the initial locale; Japan-market behavior is outside this brief.

## Motion and interactive micro-feedback

Motion design tokens live in `src/renderer/ui/tokens.css`:

- `--duration-fast`: 80ms for active tactile click feedback (subtle scale: 0.99 on buttons, 0.96 on icon buttons).
- `--duration-normal`: 140ms with easing `--ease-standard: cubic-bezier(0.16, 1, 0.3, 1)` for smooth hover backgrounds, borders, colors, and shadows.
- `--duration-modal`: 160ms for dialog fade/scale pop-in, toast notice slide-up, and outline accordion rotation.

All transitions and animations are strictly disabled under `@media (prefers-reduced-motion: reduce)`, ensuring full accessibility and immediate responsiveness for users requesting reduced motion.

## Do's and Don'ts

- Preserve the user's explicit Prism reference rather than introducing a new visual direction.
- Keep the manuscript and its rendered output central.
- Place additional capabilities where the related work already happens.
- Label proposed Loom extensions separately from observed Prism behavior.
- Do not describe an unmeasured draft as an exact visual reproduction.
- Do not allow agent changes or collaboration updates to silently replace newer manuscript edits.

## Phase 2 project and editor interactions

The real project surface reuses the Phase 1 shell, shared Modal and notification region. Project selection uses operating-system folder/ZIP dialogs; file creation uses the native save picker inside the open project, while rename/delete use app-owned dialogs. Delete retains a recoverable copy. Project controls are available through the center toolbar on a narrow desktop. File tabs are labeled toggle buttons, not incomplete ARIA tabs. Search is transient local manuscript state rather than a shareable URL; it runs against the service's rebuildable SQLite index with stale-result suppression and an immediate clear control.

CodeMirror owns source editing, syntax, line numbers, selection, search/replace and keyboard commands; Yjs owns live text. External updates apply through the binding rather than remounting the editor. Font/wrapping, file tabs, caret/selection/scroll and project layout are stored in SQLite project preferences. The existing validated local-storage layout remains the startup/browser fallback. Disk acknowledgment alone permits “Saved to disk”; conflicts and connection errors stay visible. Phase 2 kept PDF and assistant explicitly unavailable; the Phase 3 PDF behavior below supersedes that state, and the assistant remains disconnected until Phase 4.

## Refined project navigation

The supplied sidebar and expanded-composer references guide the Phase 2 UX correction. Files and Chats remain peer controls for a real project. Folder disclosure buttons and nested lists use native button semantics and Tab/Enter rather than an incomplete ARIA tree. File rows show the basename, an icon and quiet root/conflict status; full paths remain available in accessible names and titles. Stable primitive IDs retain focus across polling snapshots.

The sidebar is height-bounded. Its file browser and outline have independent scroll regions; the local workspace/settings footer is a non-shrinking sibling anchored at the bottom. Search appears on demand, supports IME, immediate clear and Enter, and keeps generation-checked results. Per-file rename/move/root/delete actions live in the shared `ActionMenu` native top-layer popover with keyboard navigation, Escape, light dismissal and focus return. Deleted files use a dedicated recovery dialog. Root metadata lives in project settings. Rename/delete use the existing Modal; errors stay inline and retain the filename.

`Project` in the source toolbar opens a compact file navigator, including at the minimum desktop size. Project selection/import and editor preferences have a separate Projects dialog. Creating a file from the navigator returns focus to the new source only after success; cancel retains the navigator and failures stay visible inside it. The toolbar owns horizontally scrolling document tabs and compact save/find/project actions; persistence status remains visible below the editor. The two-row assistant composer stays at the bottom of the center column and truthfully explains the disconnected agent. Opening a real project clears the transient example state.

CodeMirror highlighting uses the canonical `--syntax-*` dark tokens through `HighlightStyle`. Stock light-surface token colors are excluded; the representative rendered LaTeX palette is checked for at least 4.5:1 contrast against the editor background.

Project search uses one transient session shared by the sidebar, compact navigator and source editor (`editor/projectSearch.ts`). It ranks literal results before word/phrase typos and ordered filename abbreviations, labels approximate results, and shows original text rather than correcting the manuscript. A shared `ui/HighlightedText.tsx` renders safe inline marks for path/snippet ranges. Source marks are viewport decorations (`editor/searchHighlights.ts`) over the live CodeMirror document; they never rewrite text or enter undo history. Clicking a text hit selects and focuses its actual range. Search survives compact navigation, refreshes after file revisions and clears on project change; clearing/hiding the field removes decorations immediately. Ctrl F/replace remains precise and takes visual precedence while its panel is open.

Canonical search tokens are `--search-match-bg: #4b3e16`, `--search-match-text: #fff1bd` and `--search-current-bg: #6b4e12` in `ui/tokens.css`. The shared result marks, source decorations and CodeMirror Find/selection matches consume them through `workspace.css`. A focused current passage has the stronger fill and focus outline, while the active result uses the raised surface fill without a left-edge stripe. Keyboard focus retains the shared neutral outline. Native text selection remains visible; forced colors use system Highlight/HighlightText. Runtime contrast is checked at the 4.5:1 minimum. These quiet amber highlights distinguish search from action and focus roles without changing the Prism layout.

## Find/replace and focus treatment

The CodeMirror Find/replace panel retains its upstream commands, labels, input behavior and keyboard order. Its presentation is adapted in `workspace.css` using the shared charcoal surfaces, UI font, 8px control radius, 34px fields/buttons, neutral borders and motion tokens. Find/navigation occupy the first row; options and replacement controls wrap below. The close control stays at the upper right, and the panel has bounded vertical scrolling only when needed. No editor text or search/replace semantics change.

Per the user's request, focus uses the neutral `--focus: #8f8f8f` rather than bright blue. Clicking buttons/tabs or a workspace region shows no extra outline. Keyboard navigation retains a quiet 1px neutral indicator; F6 region focus is inset. Grouped search fields use the enclosing border instead of a second box around the inner input. Selection, hover, pressed state and active tabs keep their existing surface treatments. Blue remains reserved for intentional Tools/action styling and links, rather than generic focus boxes.

## Preview visibility

The source toolbar always includes a **Preview** toggle beside Tools, for empty, example and real projects. It uses the shared secondary-button styling, a right-pane icon and an `aria-pressed` state reflecting actual visibility. Closing the PDF pane returns focus to this control so it can immediately be reopened by keyboard. On a desktop it toggles the split pane without replacing the live source editor; in a narrow window it opens PDF focus mode, with existing Source/return/close controls providing the way back. At source-column widths below 450px, the toggle keeps its icon and accessible label/title while hiding the visible text to retain toolbar space. Visibility reuses the existing saved layout preferences and panel widths. The empty PDF state remains honest until Phase 3.

## Phase 3 build and PDF interactions

The researcher-facing workflow stays in the Prism workspace: **Create PDF**, **Update PDF**, **Download PDF**. The PDF header opens **PDF settings**. Default settings work without visiting a setup form; the main-document chooser appears when a choice is necessary. **Update the PDF as I write** is expressed as a writing preference. Engine, reference backend and delay in seconds sit under **Advanced settings**; tool inventories, versions, logs and rebuild are separate disclosures. Settings/actions reuse the shared Modal, native fields, button variants and notification region. Creating a PDF applies explicitly changed form choices; **Save changes** can save preferences without requesting a build. Settings write `loom.build.json`; unsaved form choices survive tool polling. Portable settings never contain executable paths.

Opening a project closes the picker after success. **Try a sample paper** creates/reopens an editable bundled sample, selects its introduction and creates the PDF without a folder picker. A dismissible writing hint suggests changing a sentence and updating the PDF. More samples live in a collapsed library. The original read-only layout reference remains distinct and available in workspace settings.

Failures use one shared inline **PDF guidance** component in the preview and settings, with a plain explanation and concrete action. Wrong-parent-folder errors offer **Open paper folder**; missing local files and style/package setup are distinguished; older failures cannot drive actions against a new root/revision/settings. Details retain original compiler output and source links. Last-successful PDFs remain visible. The explicit folder recovery saves first, preserves the selected main document when no conflicting portable config exists, and asks again when that folder has settings for another paper. Compilation never silently changes working directory.

The signature is an unobstructed paper preview and a single next action, using the existing charcoal/white Prism palette, Arial UI and monospace source. This intentionally replaces the previous technical control panel, preserving the shell and bottom-center composer. No new color or typography tokens are introduced. The fixed latexmk recipe still disables RC files and shell escape; manual editing remains available during setup.

Canonical Select/Listbox ownership is **native** for root/engine/bibliography, PDF zoom and other small fixed option sets: operating-system popup geometry and keyboard behavior are accepted. Form ownership is the app's Zod-validated contracts and labeled native inputs, shared Modal, inline errors and preserved values. Toast ownership remains Workspace's stable status region; Scrollbar ownership remains workspace.css and tokens.css. `premium-ui.json` records these decisions for the strict UI audit.

The light PDF pane uses actual PDF.js output and its worker, with a selectable text layer. Page navigation deliberately virtualizes to **one mounted page/canvas/text layer**, with a pixel budget of eight million; distant page surfaces are released. Fit-width/zoom, page number and scroll position survive successful builds and PDF focus changes within the project. Build status distinguishes saving from compilation, a failed/cancelled/interrupted build and older successful output. Older PDFs remain readable/exportable, with an explicit recompile action and older-source export title. SyncTeX actions are available only for the displayed current snapshot; unavailable mappings explain the fallback.

Source/PDF mapping has both a double-click passage gesture and a **Show source** keyboard action. **Tools → Show in PDF** maps the source caret; **Go to definition · F12** and **Complete at cursor · Ctrl Space** use TexLab. TexLab diagnostics use CodeMirror's lint gutter/hover treatment and identify unversioned server diagnostics. The existing active-file outline stays immediate; **Project structure** supplements it with literal sections, labels, bibliography keys and figure source locations across files. Unknown macro constructs remain editable. The bottom-center assistant remains reserved for Phase 4.

PDF text selection uses `--pdf-selection` from the canonical runtime tokens; canvas paper, borders, hover/status and mapping marker consume existing light-pane/focus tokens. PDF.js text-layer geometry is scoped to `.pdf-sheet`; it never restyles the app. Native modal focus, reduced motion, keyboard navigation, smaller desktop focus modes and saved panel sizes retain their established behavior.

| Capability     | Canonical owner                                       | Source of truth                          | Allowed variants                                   | Verification                                               |
| -------------- | ----------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Select/Listbox | Native labeled select                                 | DESIGN.md and contracts/latex.ts         | Fixed root, engine, bibliography, PDF zoom options | Keyboard and native popup in Electron                      |
| Form           | Labeled native inputs, Zod contracts and shared Modal | contracts/latex.ts and ui/primitives.tsx | Build settings and existing project forms          | Validation, polling preservation and narrow Electron cases |
| Scrollbar      | workspace.css global baseline                         | ui/tokens.css                            | Dark workspace and light PDF contexts              | Computed styles and narrow scroll workflows                |
| Toast          | Workspace status region                               | Workspace.tsx                            | Routine status and persistent inline errors        | Electron status and export checks                          |

Automatic PDF updates follow pauses in actual typing, independently of background save acknowledgments or polling. Routine typing/saving must not produce error banners. A manual update requested while typing remains pending; it retains clean-rebuild intent and cannot cross project changes or survive cancellation. Real save failures and genuine overlapping external edits remain visible with preserved versions.

## Phase 4 agent interactions

The user supplied T3 Code's provider settings as inspiration on 4 November 2026. Loom adopts a provider picker and a detail pane with installed version, actual connection/account/model status and optional runtime details. The Prism workspace, palette and typography remain canonical. **OpenCode** and **Codex** are native harnesses; a selected model belongs to that harness. Do not imply arbitrary executable compatibility or that the catalog proves model entitlement.

**Agent connections** reuses the shared Modal. The default workflow is choose a provider and Connect; setup guidance links to the agent's official instructions. CLI/version details and existing local OpenCode server fields stay under **Connection details**. Credentials entered for an existing server are masked, transient and cleared on close or successful connection. Missing installation, interrupted connection, unavailable desktop service, empty model catalog and request errors each have actionable text. The connection copy explains that model requests can include manuscript files and that native permissions can permit access outside the paper folder.

The assistant composer remains at the bottom of the center column. It holds a saved local prompt draft, optional source/file chips, harness connection, native model select and Send/Stop. Attachment actions explain text-only scope; images remain a later phase. **Attach a source selection** explains when a selection is needed. Source attachments and messages render as text, never injected HTML. Public native responses appear in a bounded conversation immediately above the composer, without remounting source. Chats in the existing sidebar select project-bound conversations, with their harness identified. Collapsing the conversation retains access to the manuscript.

Questions and permissions remain in the conversation, using labeled native controls and explicit **Deny** / **Allow once** actions. Polling preserves focus, typed answers and the original author prompt. Permission text reflects actual native requests; Loom does not claim a pre-write approval boundary. Running state, cancellation and reconnect guidance distinguish the agent from the local Electron service. New work remains blocked while a native operation's stop is unconfirmed.

**Review changes** opens the shared Modal and shows observed file paths, additions/deletions, bounded textual diffs or binary summaries. The copy explains that files have already changed and observation may include other external edits. Keep records review without writing; Revert requests a confirmation and checks newer source/disk state. Overlaps retain all versions and direct the author to ordinary conflict resolution. Very large differences use a labeled before/after fallback. The existing **Update PDF** action connects review to the rendered paper; no second build interface is added.

A stable 28px workspace footer holds source/persistence context, dismissible notices and **Local service** status. It occupies layout space rather than covering the composer. Error recovery stays inline in its owning surface. Rounded prompt focus uses the existing neutral keyboard-focus token; no additional palette or typography system is introduced. At 720×540, Source/PDF focus modes, scrolling dialogs and bounded conversation retain source and composer access. Native model selects, shared fields, Modal and scrollbar/status ownership follow the Phase 3 canonical components.
