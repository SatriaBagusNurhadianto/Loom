---
version: alpha
name: Loom
description: Scientific writing workspace using OpenAI Prism as the explicit interface reference, with external agents, Git, and cloud collaboration.
omitted:
  - section: colors
    reason: The dark-theme screenshot establishes palette direction; exact color tokens will be sampled during implementation.
  - section: typography
    reason: The screenshot establishes type roles but does not establish exact font families or original CSS metrics.
  - section: rounded
    reason: Component radii are pending visual reference measurement.
  - section: spacing
    reason: Reference proportions are recorded below; responsive dimensions and spacing tokens require implementation calibration.
  - section: components
    reason: This file records design direction before application components or runtime tokens exist.
---

# Loom design direction

## Overview

The user explicitly requested an interface identical to OpenAI Prism, extended with Loom's capabilities. Prism is the visual and layout reference. Match its workspace arrangement and interaction density using Loom's own name and branding.

This is a product workspace for researchers writing, revising, compiling, and reviewing LaTeX manuscripts. The accepted application direction is Electron, with external agent harnesses, Git/GitHub integration, and future authentication and cloud collaboration.

This is a reference brief, not an implemented design system. The user supplied the current Prism workspace screenshot on 3 November 2026. It is preserved at `design/references/prism-workspace.png` and is the primary visual reference. Font families, original CSS dimensions, expanded conversations, menus, and panel interactions cannot be established from the static image alone.

Reference evidence:

- Primary: the user's screenshot, `design/references/prism-workspace.png`.
- Official launch page: https://openai.com/index/introducing-prism/
- Official workspace description: https://help.openai.com/en/articles/20001050-troubleshooting-prism
- The official launch illustration describes source on the left, a compiled paper on the right, and an assistant prompt in the workspace.
- Official help documents the assistant panel at the bottom of the workspace and System, Light, and Dark appearance settings.

The reference is OpenAI Prism, not unrelated products also named Prism. The screenshot supersedes earlier inferred layout descriptions. Exact runtime metrics and behaviors remain to be established.

## Colors

The supplied reference uses a charcoal sidebar and composer, a near-black source area, a white PDF pane and paper, subdued separators, and a blue Tools control. Source highlighting distinguishes commands, braces, options, strings, and comments. Preserve this theme relationship; exact token values will be sampled from the reference. Distinguish editing, compilation, synchronization, and agent states with text as well as color.

## Typography

Match the selected reference's application text and source editor typography. The compiled manuscript keeps its document-defined typography. Exact application font metrics are intentionally deferred.

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

Future runtime tokens should have one maintained source and be mapped to this document when implementation starts. No runtime token source exists yet.

## Do's and Don'ts

- Preserve the user's explicit Prism reference rather than introducing a new visual direction.
- Keep the manuscript and its rendered output central.
- Place additional capabilities where the related work already happens.
- Label proposed Loom extensions separately from observed Prism behavior.
- Do not describe an unmeasured draft as an exact visual reproduction.
- Do not allow agent changes or collaboration updates to silently replace newer manuscript edits.
