# Loom brand assets

Official identity selected by the author on 5 November 2026. The symbol is a clean manual vector reconstruction of [the supplied image](../references/loom-logo-reference.png), preserving its silhouette and rounded channels while removing raster noise and the cursor. It is an approximation from a raster reference, not an original vector recovered from the image.

- `loom-mark.svg`: symbol, transparent background, `currentColor` (black by default).
- `loom-mark-black.svg` / `loom-mark-white.svg`: fixed-color symbol variants.
- `loom-logo.svg`: symbol and outlined Manrope SemiBold wordmark, `currentColor`.
- `loom-logo-black.svg` / `loom-logo-white.svg`: portable fixed-color lockups.
- `loom-app-icon.svg`: centered symbol on a light rounded square.
- `loom-app-icon.png`: 512px Linux window/launcher/packaging raster of that SVG.

All SVGs contain vector paths rather than embedded images. Wordmark letters are outlines; no installed font or network request is needed. SVG `currentColor` is useful inline; an external SVG used as an image does not inherit its parent's text color. The app uses the SVG as a CSS mask for theme-aware color and retains an accessible Loom name.

The shared renderer component imports the canonical SVG directly. Vite bundles it for development and `file://` production. The main-process icon is copied by electron-vite's `?asset` import. Electron Builder uses the same PNG for Linux packaging. The browser favicon copy lives in `src/renderer/public/brand/`.

## Typography

Manrope SemiBold (600) is the chosen wordmark face: its round counters echo the logo's cutouts while its straight strokes keep the identity precise. UI body text and document fonts stay unchanged.

The bundled variable source is from [Google Fonts' Manrope directory](https://github.com/google/fonts/tree/main/ofl/manrope), downloaded 5 November 2026. Its [SIL Open Font License](fonts/OFL.txt) is included. This is the OFL Google Fonts edition; do not replace it with another edition without checking that edition's license.

## Regenerate

Install Python `fonttools` in a virtual environment and system `rsvg-convert` (librsvg), then run:

```sh
python scripts/generate-brand.py
```

The script uses the bundled font at weight 600, creates the outlined letters and hand-traced symbol variants, and renders the PNG. These tools are authoring dependencies only. Keep paths undistorted, preserve transparency for the standalone marks, and leave clear space around the logo. Do not recolor individual branches or change the symbol's proportions.
