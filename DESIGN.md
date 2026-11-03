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
  focus: '#9acaff'
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

- Primary: the user's screenshot, `design/references/prism-workspace.png`.
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

Reference layout starts at 30% sidebar, 43% source, 27% PDF, with six-pixel keyboard-operable dividers. Sidebar bounds are 18–38%, PDF 22–45%, with at least 25% retained for source. Below 1100px, show Source or PDF focus mode and a compact view toolbar. Preserve split preference across automatic responsive changes. Native Electron minimum is 720×540.

The default state is honestly empty. A user-triggered synthetic example permits reference comparison without implying a real project, editor, saved file, compilation, or agent. The composer is a foundation surface with an explicit disconnected state and disabled Send. Availability dialogs explain each later-phase action. Phase 1 stored UI layout alone with a versioned, validated schema. Phase 2 real projects use the document/recovery and SQLite preferences described below; the synthetic example remains transient.

Notifications use one stable status region with a dismiss action; errors that require recovery remain inline in diagnostics. Width sliders and divider keys provide alternatives to pointer dragging. F6 cycles visible panels. Source/PDF/Split controls and Ctrl Alt 1/2/3 provide focus modes; Ctrl Alt B toggles sidebar. Reduced motion and forced colors are handled globally. English desktop is the initial locale; Japan-market behavior is outside this brief.

## Do's and Don'ts

- Preserve the user's explicit Prism reference rather than introducing a new visual direction.
- Keep the manuscript and its rendered output central.
- Place additional capabilities where the related work already happens.
- Label proposed Loom extensions separately from observed Prism behavior.
- Do not describe an unmeasured draft as an exact visual reproduction.
- Do not allow agent changes or collaboration updates to silently replace newer manuscript edits.

## Phase 2 project and editor interactions

The real project surface reuses the Phase 1 shell, shared Modal and notification region. Project selection uses operating-system folder/ZIP dialogs; file creation uses the native save picker inside the open project, while rename/delete use app-owned dialogs. Delete retains a recoverable copy. Project controls are available through the center toolbar on a narrow desktop. File tabs are labeled toggle buttons, not incomplete ARIA tabs. Search is transient local manuscript state rather than a shareable URL; it runs against the service's rebuildable SQLite index with stale-result suppression and an immediate clear control.

CodeMirror owns source editing, syntax, line numbers, selection, search/replace and keyboard commands; Yjs owns live text. External updates apply through the binding rather than remounting the editor. Font/wrapping, file tabs, caret/selection/scroll and project layout are stored in SQLite project preferences. The existing validated local-storage layout remains the startup/browser fallback. Disk acknowledgment alone permits “Saved to disk”; conflicts and connection errors stay visible. PDF and assistant remain explicitly unavailable until their respective phases.
