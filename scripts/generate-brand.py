"""Regenerate committed Loom vectors and Linux PNG. Requires fonttools and rsvg-convert.

Run from any directory: python scripts/generate-brand.py
The bundled OFL font is build-time input only; application logos contain outlines.
"""

from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import subprocess

root = Path(__file__).resolve().parent.parent
brand = root / "design/brand"
public = root / "src/renderer/public/brand"
public.mkdir(parents=True, exist_ok=True)
# Trace of the supplied silhouette, in reference-image coordinates. Rounded inner
# cuts are cubic Beziers; outer terminals retain their original asymmetric angles.
d = """M 164 197 L 263 197 L 263 102 L 279 92 L 349 216 C 357 231 369 238 382 231 C 399 222 406 210 397 194 L 326 65 L 342 55 L 417 186 L 474 93 L 489 102 L 418 227 C 407 246 411 260 425 267 C 440 275 454 270 463 254 L 535 129 L 551 138 L 551 271 L 585 271 L 585 290 L 439 290 C 422 290 411 301 411 316 C 411 331 422 342 439 342 L 585 342 L 585 550 L 490 550 L 490 642 L 471 652 L 471 467 L 398 341 C 390 326 377 322 364 328 C 349 335 346 348 354 363 L 427 490 L 427 678 L 411 688 L 333 552 L 280 653 L 264 644 L 264 455 L 334 332 C 342 317 338 303 325 294 C 312 285 298 291 289 306 L 217 430 L 217 616 L 199 606 L 199 477 L 165 477 L 165 270 L 312 270 C 329 270 339 259 339 244 C 339 228 328 216 312 216 L 164 216 Z"""
mark = f'<path transform="translate(-164 -55)" d="{d}"/>'
font = instantiateVariableFont(
    TTFont(brand / "fonts/Manrope-variable.ttf"), {"wght": 600}, inplace=False
)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font["head"].unitsPerEm
text = []
x = 64
scale = 45 / units
for letter in "Loom":
    name = cmap[ord(letter)]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 46)))
    text.append(f'<path d="{pen.getCommands()}"/>')
    x += glyphs[name].width * scale - 0.8
lockup = f'<g transform="scale(0.1)">{mark}</g>' + "".join(text)
for name, body, box in [
    ("mark", mark, "0 0 422 634"),
    ("logo", lockup, f"0 0 {x+2:.2f} 64"),
]:
    for variant, color in [
        ("", "currentColor"),
        ("-black", "#000000"),
        ("-white", "#ffffff"),
    ]:
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" fill="{color}" role="img" aria-label="Loom"><title>Loom</title>{body}</svg>\n'
        (brand / f"loom-{name}{variant}.svg").write_text(svg)
# Square icon uses a light field for contrast in OS launchers of either appearance.
icon = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="208" fill="#fafafa"/><g transform="translate(256 128) scale(1.21)" fill="#171717">{mark}</g></svg>\n'
(brand / "loom-app-icon.svg").write_text(icon)
(public / "loom-app-icon.svg").write_text(icon)
subprocess.run(
    [
        "rsvg-convert",
        "-w",
        "512",
        "-h",
        "512",
        str(brand / "loom-app-icon.svg"),
        "-o",
        str(brand / "loom-app-icon.png"),
    ],
    check=True,
)
