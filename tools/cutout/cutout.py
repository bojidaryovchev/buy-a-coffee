"""Cut packshots out to transparency — DESIGN.md, "Imagery"; IMPLEMENTATION_PLAN.md, K1.

    python cutout.py <in dir> <out dir>

Reads every `<hash>.<jpg|png|webp>` in <in dir> (the photo's content hash is
its name), writes `<hash>.png` for each cut-out it makes, and `report.json`:
one entry per photo with what was measured and what was done. The Node side
(`pnpm images:cutout`) uploads the PNGs and records the report; this script
touches no database and no network except to fetch the models once.

The method, measured on 13 of the shop's packs on 19 October 2026:

1. The photo's own ground (light grey, #f1 to #f9, letterboxed on white) is
   levelled to white, so its edge pixels blend toward white.
2. Two background-removal models run on it: BiRefNet lite and BiRefNet full.
   Each fails on different packs — a cup printed on a box fools them — so a
   pixel is pack if either says so.
3. Where the two agree on fewer than AGREE of the pixels, the cut-out waits
   for a person (11 of 13 agreed on 99.8 % or more; the two that did not
   agreed on about 50 %).
4. The shape check: a pack is solid. Enclosed holes are filled; a gap reaching
   deeper than DENT_DEPTH into the pack is filled back (badge and crimp gaps
   reached 0.26 at most, the misses 0.35 and 0.51); a pack that then nearly
   fills its bounding box is a box and snaps to it.
5. The white edge is taken out of the soft border (each edge pixel is unmixed
   from white), and the result is trimmed to the pack.

Status is "auto" when the models agreed and nothing was filled, "pending"
otherwise. Models are cached under U2NET_HOME.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import convex_hull_image

MODELS = ("birefnet-general-lite", "birefnet-general")
AGREE = 0.99
DENT_DEPTH = 0.30
BOX_FIT = 0.90
MAX_SIDE = 1200  # the photos are 800 x 1200; nothing is upscaled


PAD = 12


def level(rgb: np.ndarray) -> np.ndarray:
    """The photo cropped out of its white canvas (with a margin for the models),
    its own ground levelled to white."""
    lum = rgb.mean(axis=2)
    ys, xs = np.where(lum < 252)
    if len(ys) == 0:
        return rgb
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    ring = np.concatenate([rgb[y0, x0:x1 + 1], rgb[y1, x0:x1 + 1], rgb[y0:y1 + 1, x0], rgb[y0:y1 + 1, x1]])
    ground = np.median(ring, axis=0)
    levelled = np.clip(rgb * (255.0 / np.maximum(ground, 1)), 0, 255)
    h, w = lum.shape
    return levelled[max(0, y0 - PAD):min(h, y1 + PAD + 1), max(0, x0 - PAD):min(w, x1 + PAD + 1)]


def soft(mask: np.ndarray) -> np.ndarray:
    """A model's 0..1 mask with its outermost, mostly-ground row tightened."""
    return np.clip((mask - 0.08) / 0.88, 0, 1)


def shape_check(alpha: np.ndarray) -> tuple[np.ndarray, dict]:
    """Fill holes and deep dents; snap a dented box to its rectangle."""
    solid = alpha > 0.5
    labels, count = ndimage.label(solid)
    if count > 1:
        sizes = ndimage.sum(solid, labels, range(1, count + 1))
        solid = np.isin(labels, [i + 1 for i, s in enumerate(sizes) if s > 0.002 * solid.sum()])
    holes = ndimage.binary_fill_holes(solid) & ~solid
    body = solid | holes
    if not body.any():
        return alpha, {"holes": 0.0, "dents": [], "box": None}
    hull = convex_hull_image(body)
    hull_area = hull.sum()
    depth = ndimage.distance_transform_edt(hull) / np.sqrt(hull_area)
    gaps, gap_count = ndimage.label(hull & ~body)
    dents = np.zeros_like(body)
    dent_report = []
    for index in range(1, gap_count + 1):
        region = gaps == index
        reach = float(depth[region].max())
        if reach > DENT_DEPTH:
            dents |= region
            dent_report.append({"share": round(float(region.sum() / hull_area), 4), "depth": round(reach, 3)})
    fill = holes | dents
    outline = hull
    box = None
    if dents.any():
        whole = body | dents
        ys, xs = np.where(whole)
        rect = np.zeros_like(whole)
        rect[ys.min():ys.max() + 1, xs.min():xs.max() + 1] = True
        box = round(float(whole.sum() / rect.sum()), 4)
        if box > BOX_FIT:
            fill = fill | (rect & ~body)
            outline = rect
    if fill.any():
        # Cover the half-transparent band the wrong cut left, but stop two
        # pixels inside the outline, where the model's own soft edge is right.
        inner = ndimage.binary_erosion(outline, iterations=2)
        fill = ndimage.binary_dilation(fill, iterations=10) & inner
    fill_soft = np.where(fill, 1.0, ndimage.gaussian_filter(fill.astype(np.float32), 0.8))
    report = {"holes": round(float(holes.sum() / hull_area), 4), "dents": dent_report, "box": box}
    return np.maximum(alpha, fill_soft), report


def unmix_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """An edge pixel is a*F + (1-a)*white; recover F so no white fringe shows."""
    a = alpha[..., None]
    fg = np.where(a > 0.02, (rgb - (1 - a) * 255.0) / np.maximum(a, 0.02), rgb)
    return np.clip(fg, 0, 255)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.splitlines()[2].strip(), file=sys.stderr)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    import onnxruntime as ort
    from rembg import new_session, remove  # imported late: slow, and only needed here

    # Without its CPU arena: with it, the process committed 36 GB at the first
    # photo and kept it, which a 16 GB runner does not have; without it, 7 to
    # 9 GB throughout (measured on 8 photos, 20 October 2026).
    options = ort.SessionOptions()
    options.enable_cpu_mem_arena = False
    sessions = {name: new_session(name, sess_opts=options) for name in MODELS}
    report: dict[str, dict] = {}
    for path in sorted(p for p in src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")):
        key = path.stem
        try:
            image = Image.open(path).convert("RGB")
            image.thumbnail((MAX_SIDE, MAX_SIDE))
            rgb = level(np.asarray(image).astype(np.float32))
            source = Image.fromarray(rgb.astype(np.uint8))
            masks = [
                np.asarray(remove(source, session=sessions[name], only_mask=True)).astype(np.float32) / 255.0
                for name in MODELS
            ]
            agreement = float(((masks[0] > 0.5) == (masks[1] > 0.5)).mean())
            alpha, shape = shape_check(soft(np.maximum(masks[0], masks[1])))
            filled = shape["holes"] > 0.001 or bool(shape["dents"])
            rgba = np.dstack([unmix_white(rgb, alpha), alpha * 255]).astype(np.uint8)
            cut = Image.fromarray(rgba, "RGBA")
            bbox = cut.getbbox()
            if bbox is None:
                raise ValueError("the models found no pack")
            cut = cut.crop(bbox)
            out = dst / f"{key}.png"
            cut.save(out, "PNG", optimize=True)
            report[key] = {
                "file": out.name,
                "width": cut.width,
                "height": cut.height,
                "agreement": round(agreement, 4),
                "shape": shape,
                "status": "auto" if agreement >= AGREE and not filled else "pending",
                "models": list(MODELS),
            }
        except Exception as error:  # one bad photo must not stop the batch
            report[key] = {"error": f"{type(error).__name__}: {error}"}
        print(json.dumps({key: report[key]}), flush=True)
    (dst / "report.json").write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
