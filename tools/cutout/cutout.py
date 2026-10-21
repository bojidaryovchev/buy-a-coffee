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
4. The ground check (version 2, measured on all 215 of the shop's photos on
   22 October 2026): both models can agree on a wrong cut — on Rema Cortado
   they agreed on 99.8 % of the pixels and both kept only the cup printed on
   the box. So the photo's own ground decides. From the edge of the frame it
   spreads through every pixel that is no edge (SMOOTH: a shadow or a glow
   fades, a pack's outline does not), over gaps in the outline a few pixels
   wide. What it cannot reach, is not white, and is no grey cast shadow
   (SHADOW) is pack, if it is wider than a rim (RIM) somewhere. Nothing is
   added under a standing pack's base (BASE_EDGE); there, a pixel only one
   model claimed is dropped when the floor mirrors the pack (MIRROR) — a
   bag's own light lower panel is not its reflection.
5. The shape check: a pack is solid. Enclosed holes are filled; a gap reaching
   deeper than DENT_DEPTH into the pack is filled back (badge and crimp gaps
   reached 0.26 at most, the misses 0.35 and 0.51); a pack that then nearly
   fills its bounding box is a box and snaps to it.
6. The white edge is taken out of the soft border (each edge pixel is unmixed
   from white), and the result is trimmed to the pack.

Status is "auto" when the models agreed and neither check changed the pack
(the ground check makes no change of QUIET or less); "pending" otherwise. A
white pack on the white ground, or a grey or silver one, is beyond the ground
check, which cannot tell it from the ground or a shadow; only a person can.
Models are cached under U2NET_HOME.
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
VERSION = 2  # 2: the ground check (22 October 2026)
AGREE = 0.99
GROUND = 8  # a pixel this close to the levelled white could be the ground
SMOOTH = 40  # edge strength: a shadow or a glow fades below it, a pack's outline does not
BASE_EDGE = 120  # the edge a standing pack's base makes against its floor
RIM = 6  # px: narrower than twice this, a band round the models' outline is edge or shadow, not a miss
SHADOW = (12, 90)  # colour spread and distance from white under which a pixel may be a cast shadow
MIRROR = 0.5  # how closely what lies under a base must mirror the pack to be its reflection
MIRROR_GAIN = 0.2  # how much better a blurred reflection pairs upside down than the right way up
QUIET = 0.005  # what the ground check may change and the cut-out still go live by itself
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


def edges(rgb: np.ndarray) -> np.ndarray:
    """Edge strength: the steepest of the three channels' gradients, after a
    light blur so the JPEG's own noise does not count as an edge."""
    strength = np.zeros(rgb.shape[:2], np.float32)
    for channel in range(3):
        smooth = ndimage.gaussian_filter(rgb[..., channel], 0.7)
        strength = np.maximum(strength, np.hypot(ndimage.sobel(smooth, 0), ndimage.sobel(smooth, 1)))
    return strength


def floor_line(off: np.ndarray, pack: np.ndarray) -> int | None:
    """The row of a standing pack's base, when a floor shows under it.

    Read across the middle half of the pack, from the bottom up: the first row
    with a sharp horizontal edge that has far less of "not the ground" under it
    than over it. Under that row lie only the pack's shadow and reflection. A
    pack lying flat has nothing under its own bottom edge, so cutting there
    takes nothing away."""
    ys, xs = np.where(pack)
    if len(ys) == 0:
        return None
    left, right = xs.min() + (xs.max() - xs.min()) // 4, xs.max() - (xs.max() - xs.min()) // 4 + 1
    row_off = np.median(off[:, left:right], axis=1)
    row_edge = np.median(np.abs(ndimage.sobel(ndimage.gaussian_filter(off, 0.7), 0))[:, left:right], axis=1)
    for y in range(ys.max() - 3, (ys.min() + ys.max()) // 2, -1):
        if row_edge[y] < BASE_EDGE:
            continue
        over = float(np.median(row_off[max(0, y - 14):y - 2]))
        under = float(np.median(row_off[y + 3:y + 15])) if y + 15 < len(row_off) else 0.0
        if over > 60 and under < 0.5 * over:
            return y
    return None


def reflection(rgb: np.ndarray, base: int, left: int, right: int) -> bool:
    """Whether what lies under a base is the pack's reflection: the rows above
    it, upside down and faded toward white, at the best of a few offsets for
    the base's own thickness.

    Either each row under is the row over blended with white (a sharp mirror,
    as under Bianchi Gusto Forte), or the rows pair up better upside down than
    the right way up (a blurred one, as under Caffitaly Panettone). A pack's
    own lower panel passes neither: sharing its shading with the band above
    pairs it as well either way, and it is no fainter copy of it."""
    gray = rgb.mean(axis=2) - 255.0
    for shift in range(5):
        reach = min(60, base, gray.shape[0] - base - shift)
        fits, flipped, straight = [], [], []
        for k in range(2, reach):
            under = gray[base + shift + k, left:right]
            over = gray[base - k, left:right]
            same_way = gray[base - reach - 1 + k, left:right]
            if under.std() <= 2 or over.std() <= 4 or same_way.std() <= 4:
                continue
            fade = float(np.clip(under @ over / max(float(over @ over), 1e-6), 0, 1))
            spread = float(((under - under.mean()) ** 2).sum())
            fits.append(1 - float(((under - fade * over) ** 2).sum()) / max(spread, 1e-6))
            flipped.append(float(np.corrcoef(over, under)[0, 1]))
            straight.append(float(np.corrcoef(same_way, under)[0, 1]))
        if len(fits) < 10:
            continue
        if np.median(fits) >= MIRROR:
            return True
        if np.median(flipped) >= MIRROR and np.median(flipped) - np.median(straight) >= MIRROR_GAIN:
            return True
    return False


def ground_check(rgb: np.ndarray, a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, dict]:
    """The two models' masks, corrected by the photo's own ground.

    Both models can miss a whole box around a picture printed on it, and one
    can take a reflection for the pack. The photo itself says better: from the
    edge of the frame, the ground spreads through every pixel that is no edge
    — a shadow or a glow fades, so it is ground too — and stops at the pack's
    outline (small gaps in it closed). What it cannot reach, is not white and
    is no grey cast shadow, and is more than the thin rim of the models' own
    outline, is pack whatever the models said. Nothing under a standing pack's
    base is added; there, a pixel only one model claimed is dropped when the
    floor holds the pack's reflection.

    A change of no more than QUIET of the pack is not made at all, so a
    cut-out that goes live by itself is exactly what the models cut; holes are
    left to the shape check, which has its own, stricter limit.
    """
    union, agreed = np.maximum(a, b) > 0.5, np.minimum(a, b) > 0.5
    off = np.abs(255.0 - rgb).max(axis=2)
    barrier = ndimage.binary_closing((edges(rgb) >= SMOOTH) | union, iterations=3)
    reach, _ = ndimage.label(~barrier)
    frame = np.concatenate([reach[0], reach[-1], reach[:, 0], reach[:, -1]])
    ground = np.isin(reach, frame[frame > 0])
    # A cast shadow is grey and light; what a model misses of a pack is
    # printed: dark, or coloured, even when it is cream.
    shadow = (rgb.max(axis=2) - rgb.min(axis=2) < SHADOW[0]) & (off < SHADOW[1])
    missed = ~ground & (off >= GROUND) & ~shadow & ~union
    # Only a miss wide somewhere counts, grown back to its own edges so a
    # box's corner stays square; the thin rim of an outline or a contact
    # shadow never has such a core.
    core = ndimage.binary_opening(missed, iterations=RIM)
    missed = ndimage.binary_dilation(core, iterations=RIM + 2, mask=missed)
    kept = union
    base = floor_line(off, union | missed)
    if base is not None:
        under = np.zeros_like(union)
        under[base + 2:] = True
        missed &= ~under
        xs = np.where(union[base])[0]
        if len(xs) > 1 and reflection(rgb, base, xs.min(), xs.max() + 1):
            kept = union & ~(under & ~agreed)
    # What the ground check adds must touch what the models found: a speck
    # of dust on the ground is not a pack.
    pack = kept | missed
    parts, _ = ndimage.label(pack)
    pack = np.isin(parts, np.unique(parts[kept]))
    added, removed = pack & ~union, union & ~pack
    total = max(int(pack.sum()), 1)
    report = {
        "added": round(float(added.sum() / total), 4),
        "removed": round(float(removed.sum() / total), 4),
    }
    model = soft(np.maximum(a, b))
    if report["added"] + report["removed"] <= QUIET:
        return model, {"added": 0.0, "removed": 0.0}
    # Solid where the models missed and where a model's edge ran through the
    # middle of the pack; their own soft edge on the outline they drew.
    solid = (ndimage.binary_erosion(pack, iterations=3) | added).astype(np.float32)
    alpha = np.maximum(model, np.maximum(solid, ndimage.gaussian_filter(solid, 0.8)))
    if kept is not union:
        alpha[under & ~pack] = 0.0  # the reflection, soft edge and all
    return alpha, report


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


def cut_alpha(rgb: np.ndarray, a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, dict]:
    """The pack's alpha from the photo and the two models' 0..1 masks, and
    what each check did to it."""
    alpha, ground = ground_check(rgb, a, b)
    alpha, shape = shape_check(alpha)
    return alpha, {**shape, **ground}


def status_of(agreement: float, shape: dict) -> str:
    """Live by itself only when the models agreed and no check changed the pack."""
    filled = shape["holes"] > 0.001 or bool(shape["dents"])
    changed = shape["added"] + shape["removed"] > QUIET
    return "auto" if agreement >= AGREE and not filled and not changed else "pending"


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
            alpha, shape = cut_alpha(rgb, masks[0], masks[1])
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
                "status": status_of(agreement, shape),
                "models": list(MODELS),
                "version": VERSION,
            }
        except Exception as error:  # one bad photo must not stop the batch
            report[key] = {"error": f"{type(error).__name__}: {error}"}
        print(json.dumps({key: report[key]}), flush=True)
    (dst / "report.json").write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
