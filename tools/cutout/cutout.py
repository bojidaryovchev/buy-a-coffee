"""Cut packshots out to transparency — DESIGN.md, "Imagery"; IMPLEMENTATION_PLAN.md, K1.

    python cutout.py <in dir> <out dir>

Reads every `<hash>.<jpg|png|webp>` photo in <in dir> (the photo's content
hash is its name) with `<hash>.model.png` beside it: the model's cut-out of
that photo, the photo's own size, the pack opaque. Writes `<hash>.png` for
each cut-out it makes, and `report.json`: one entry per photo with what was
measured and what was done. The Node side (`pnpm images:cutout`) calls the
model, uploads the PNGs and records the report; this script touches no
database and no network, and holds no key.

The method (version 4, 26 October 2026):

1. The model is BRIA RMBG 2.0, run by fal. On the shop's 20 hardest photos
   (a cup or a capsule printed on a box, glossy floors, a cream box, white,
   grey and silver packs) it alone was right on all 20, where two BiRefNet
   models together, with the checks below, were right on 19 and before them
   on 13 (docs/decisions.md, "BRIA through fal").
2. The photo's own ground (light grey, #f1 to #f9, letterboxed on white) is
   levelled to white, so its edge pixels blend toward white.
3. The ground check, as a second opinion that owes nothing to the model: from
   the edge of the frame the ground spreads through every pixel that is no
   edge (SMOOTH: a shadow or a glow fades, a pack's outline does not), over
   gaps in the outline a few pixels wide. What it cannot reach, is not white,
   and is no grey cast shadow (SHADOW) is pack, if it is wider than a rim
   (RIM) somewhere; nothing is added under a standing pack's base
   (BASE_EDGE). A cut that reaches below the base onto a floor that holds the
   pack's reflection (MIRROR, MIRROR_GAIN) is shown to a person, unchanged —
   a bag's own light lower panel is not its reflection — and so is one that
   kept a light grey shadow beyond the pack's own print, or reaches the frame.
   A count badge the model dropped ("x100" in a white ring on a pod's corner,
   which the owner wants kept) is put back as a disc with its ring (BADGE,
   ROUND): on the whole catalog it was dropped from 12 pods, found on all 12,
   and nothing else was taken for one (26 October 2026, version 4).
4. The shape check: a pack is solid. Enclosed holes are filled; a gap reaching
   deeper than DENT_DEPTH into the pack is filled back (badge and crimp gaps
   reached 0.26 at most, the misses 0.35 and 0.51); a pack that then nearly
   fills its bounding box is a box and snaps to it.
5. The white edge is taken out of the soft border (each edge pixel is unmixed
   from white), and the result is trimmed to the pack.

Status is "auto" when no check changed the pack (the ground check makes no
change of QUIET or less, and a count badge put back is no change) or
questioned it: a reflection kept under the base, a light grey shadow kept
beyond the pack's print, a cut reaching the frame. "pending" otherwise. The ground check cannot tell a white, grey or silver pack
from the ground or a shadow, so a white box with a blank border is shown to a
person; and it cannot see a dark, patterned reflection kept under a light
pack, which only BRIA's own judgement keeps out.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import convex_hull_image

MODEL = "fal-ai/bria/background/remove"
VERSION = 4  # 2: the ground check; 3: BRIA RMBG 2.0 through fal (22 October 2026); 4: count badges kept
GROUND = 8  # a pixel this close to the levelled white could be the ground
SMOOTH = 40  # edge strength: a shadow or a glow fades below it, a pack's outline does not
BASE_EDGE = 120  # the edge a standing pack's base makes against its floor
RIM = 6  # px: narrower than twice this, a band round the model's outline is edge or shadow, not a miss
SHADOW = (12, 90)  # colour spread and distance from white under which a pixel may be a cast shadow
MIRROR = 0.5  # how closely what lies under a base must mirror the pack to be its reflection
MIRROR_GAIN = 0.2  # how much better a blurred reflection pairs upside down than the right way up
BELOW = 0.01  # share of the cut under a standing pack's base worth asking a person about
QUIET = 0.005  # what the ground check may change and the cut-out still go live by itself
BADGE = (0.01, 0.2)  # share of the pack a count badge covers; the shop's cover 0.05 to 0.08
ROUND = 0.95  # how much of a badge lies within the largest circle inside it: a disc, nothing more
DENT_DEPTH = 0.30
BOX_FIT = 0.90
MAX_SIDE = 1200  # the photos are 800 x 1200; nothing is upscaled


PAD = 12


def framing(rgb: np.ndarray) -> tuple[slice, slice]:
    """Where the photo sits on its white canvas, with a margin: the part the
    tool works on."""
    lum = rgb.mean(axis=2)
    ys, xs = np.where(lum < 252)
    h, w = lum.shape
    if len(ys) == 0:
        return slice(0, h), slice(0, w)
    return (
        slice(max(0, ys.min() - PAD), min(h, ys.max() + PAD + 1)),
        slice(max(0, xs.min() - PAD), min(w, xs.max() + PAD + 1)),
    )


def level(rgb: np.ndarray) -> np.ndarray:
    """The photo cropped out of its white canvas (`framing`), its own ground
    levelled to white."""
    lum = rgb.mean(axis=2)
    ys, xs = np.where(lum < 252)
    if len(ys) == 0:
        return rgb
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    ring = np.concatenate([rgb[y0, x0:x1 + 1], rgb[y1, x0:x1 + 1], rgb[y0:y1 + 1, x0], rgb[y0:y1 + 1, x1]])
    ground = np.median(ring, axis=0)
    levelled = np.clip(rgb * (255.0 / np.maximum(ground, 1)), 0, 255)
    return levelled[framing(rgb)]


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


def badges(off: np.ndarray, union: np.ndarray, coloured: np.ndarray) -> np.ndarray:
    """The count badges the model dropped, as a 0..1 alpha.

    The shop's photos of pods and capsules carry an "x100" sticker: a coloured
    disc in a white ring at a corner of the pack, clear of it or over it, and
    the owner wants it kept. BRIA drops it whole, or keeps a piece. A badge is
    a disc of colour the ground cannot reach: of a badge's size (BADGE), with
    nothing beyond the largest circle inside it (ROUND), within a rim's width
    of the model's cut and mostly not in it. It is looked for in the cores of
    that colour without the model's cut, as a badge over the pack runs into
    the pack's colour, and with it, as a piece the model kept is part of the
    disc. It comes back with its white ring (`ring`), as a circle with a soft
    edge a pixel wide."""
    size = max(int(union.sum()), 1)
    near = ndimage.distance_transform_edt(~union)
    yy, xx = np.indices(union.shape)
    alpha = np.zeros(union.shape, np.float32)
    for region in (coloured & ~union, coloured):
        parts, _ = ndimage.label(ndimage.binary_opening(region, iterations=RIM))
        areas = np.bincount(parts.ravel())
        areas[0] = 0
        for index in np.flatnonzero((areas >= BADGE[0] * size) & (areas <= BADGE[1] * size)):
            disc = ndimage.binary_fill_holes(parts == index)
            depth = ndimage.distance_transform_edt(disc)
            cy, cx = np.unravel_index(np.argmax(depth), depth.shape)
            if alpha[cy, cx] > 0:
                continue  # found in the first look
            radius = float(depth[cy, cx])
            rad = np.hypot(yy - cy, xx - cx)
            if (disc & (rad <= radius + 2)).sum() < ROUND * disc.sum():
                continue
            if union[rad <= radius].mean() >= 0.5:
                continue  # the model kept it
            if near[(rad > radius) & (rad <= radius + 1.5)].min() > 2 * RIM:
                continue  # not at this pack's edge
            edge = radius + ring(off, union, rad, radius)
            alpha = np.maximum(alpha, np.clip(edge - rad + 0.5, 0, 1))  # a pixel's share inside the edge
    return alpha


def ring(off: np.ndarray, union: np.ndarray, rad: np.ndarray, radius: float) -> int:
    """How far a badge's white ring reaches past its disc: out circle by circle
    (the median of each, the pack left out) to where the ring's shadow rises a
    step (GROUND) out of the white again. Where no shadow shows, a white ring
    cannot be told from the ground, and the badge is cut at its disc's edge."""
    lowest, edge = None, None
    for k in range(max(RIM, int(0.2 * radius))):
        band = (rad >= radius + k) & (rad < radius + k + 1) & ~union
        if not band.any():
            continue
        level_ = float(np.median(off[band]))
        if lowest is not None and level_ >= lowest + GROUND:
            return k
        if lowest is None or level_ < lowest:
            lowest = level_
        if edge is None and level_ < GROUND:
            edge = k
    return 0 if edge is None else edge


def ground_check(rgb: np.ndarray, model: np.ndarray) -> tuple[np.ndarray, dict, np.ndarray]:
    """The model's mask, checked against the photo's own ground; and apart, the
    count badges the model dropped, to be laid over the pack once its shape is
    checked.

    A model can miss a whole box around a picture printed on it, keep a shadow
    or the photo's backdrop, and take a reflection for the pack. The photo
    itself says otherwise: from the edge of the frame, the ground spreads
    through every pixel that is no edge — a shadow or a glow fades, so it is
    ground too — and stops at the pack's outline (small gaps in it closed).

    - What it cannot reach, is not white and is no grey cast shadow, and is
      more than the thin rim of the model's own outline, is pack whatever the
      model said, and is added. Nothing under a standing pack's base is added.
    - What the model kept that it does reach, light and grey like a shadow and
      outside the pack's own print, is reported (`kept`), not removed: a white
      box's blank border looks the same, and only a person can tell them
      apart.
    - A cut that reaches the edge of the frame has kept the backdrop
      (`framed`), and one that goes on under a standing pack's base onto its
      reflection (`reflection`); both are left as they are and reported.
    - A count badge the model dropped is put back (`badges`), with or without
      anything else, and its share of the pack reported (`badge`).

    A change of no more than QUIET of the pack is not made at all, so a
    cut-out that goes live by itself is exactly what the model cut, but for a
    count badge; holes are left to the shape check, which has its own, stricter
    limit.
    """
    union = model > 0.5
    off = np.abs(255.0 - rgb).max(axis=2)
    strong = edges(rgb) >= SMOOTH

    def from_frame(barrier: np.ndarray) -> np.ndarray:
        reach, _ = ndimage.label(~ndimage.binary_closing(barrier, iterations=3))
        frame = np.concatenate([reach[0], reach[-1], reach[:, 0], reach[:, -1]])
        return np.isin(reach, frame[frame > 0])

    def wide(region: np.ndarray) -> np.ndarray:
        """Only what is wide somewhere, grown back to its own edges so a box's
        corner stays square; the thin rim of an outline never is."""
        core = ndimage.binary_opening(region, iterations=RIM)
        return ndimage.binary_dilation(core, iterations=RIM + 2, mask=region)

    ground = from_frame(strong | union)
    # A cast shadow is grey and light; what a model misses of a pack is
    # printed: dark, or coloured, even when it is cream.
    grey = rgb.max(axis=2) - rgb.min(axis=2) < SHADOW[0]
    shadow = grey & (off < SHADOW[1])
    coloured = ~ground & (off >= GROUND) & ~shadow
    missed = coloured & ~union
    reflected = False
    base = floor_line(off, union | missed)
    if base is not None:
        missed[base + 2:] = False
        coloured[base + 2:] = False
        below = union[base + 2:].sum()
        xs = np.where(union[base])[0]
        if below > BELOW * max(int(union.sum()), 1) and len(xs) > 1:
            reflected = reflection(rgb, base, xs.min(), xs.max() + 1)
    # A miss counts only where it is wide; a contact shadow never is, nor is
    # what is left above a floor.
    missed = wide(missed)
    # What the ground check adds must touch what the model found: a speck of
    # dust on the ground is not a pack. A count badge is the one thing put
    # back that need not, and it is no change for a person to look at.
    badge = badges(off, union, coloured)
    pack = union | missed
    parts, _ = ndimage.label(pack)
    pack = np.isin(parts, np.unique(parts[union]))
    added = pack & ~union & (badge == 0)
    share = round(float(added.sum() / max(int(pack.sum()), 1)), 4)
    # What the model kept that the ground reaches through the model's mask
    # too: light grey like a shadow, beyond the hull of the pack's own print.
    print_ = strong & ndimage.binary_erosion(union, iterations=RIM)
    printed = ndimage.binary_dilation(convex_hull_image(print_), iterations=RIM) if print_.any() else union
    extra = wide(union & from_frame(strong) & grey & (off >= GROUND) & (off < SHADOW[1]) & ~printed)
    report = {
        "added": share,
        "reflection": reflected,
        "kept": round(float(extra.sum() / max(int(union.sum()), 1)), 4),
        "framed": framed(union),
        "badge": round(float(((badge > 0.5) & ~union).sum() / max(int(union.sum()), 1)), 4),
    }
    alpha = soft(model)
    if share <= QUIET:
        return alpha, {**report, "added": 0.0}, badge
    # Solid where the model missed and where its edge ran through the middle
    # of the pack; its own soft edge on the outline it drew.
    solid = (ndimage.binary_erosion(pack, iterations=3) | added).astype(np.float32)
    alpha = np.maximum(alpha, np.maximum(solid, ndimage.gaussian_filter(solid, 0.8)))
    return alpha, report, badge


def framed(union: np.ndarray) -> bool:
    """Whether the cut reaches the edge of the frame, where only the photo's
    backdrop is: the tool works on the photo with a margin round it."""
    ys, xs = np.where(union)
    if len(ys) == 0:
        return False
    h, w = union.shape
    margin = PAD // 2
    return bool(ys.min() < margin or xs.min() < margin or ys.max() >= h - margin or xs.max() >= w - margin)


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


def cut_alpha(rgb: np.ndarray, model: np.ndarray) -> tuple[np.ndarray, dict]:
    """The pack's alpha from the levelled photo and the model's 0..1 mask, and
    what each check did to it."""
    alpha, ground, badge = ground_check(rgb, model)
    # The shape check is for the pack alone: where a badge's soft edge meets
    # the pack it would find a hole, and fill the badge's shadow round it.
    alpha, shape = shape_check(alpha)
    return np.maximum(alpha, badge), {**shape, **ground}


def status_of(shape: dict) -> str:
    """Live by itself only when no check changed the pack or questioned it."""
    filled = shape["holes"] > 0.001 or bool(shape["dents"])
    changed = shape["added"] > QUIET
    questioned = shape["reflection"] or shape["kept"] > QUIET or shape["framed"]
    return "pending" if filled or changed or questioned else "auto"


def unmix_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """An edge pixel is a*F + (1-a)*white; recover F so no white fringe shows."""
    a = alpha[..., None]
    fg = np.where(a > 0.02, (rgb - (1 - a) * 255.0) / np.maximum(a, 0.02), rgb)
    return np.clip(fg, 0, 255)


def cut_one(photo: Path, model_png: Path) -> tuple[Image.Image, dict]:
    """One photo and the model's answer for it: the trimmed cut-out and what the checks did."""
    image = Image.open(photo).convert("RGB")
    model = Image.open(model_png)
    # The model answers at the photo's own size, with transparency: anything
    # else is not a cut-out of this photo.
    if model.size != image.size:
        raise ValueError(f"the model's answer is {model.size}, the photo {image.size}")
    if "A" not in model.getbands() and "transparency" not in model.info:
        raise ValueError("the model's answer has no transparency")
    model = model.convert("RGBA")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    if model.size != image.size:
        model = model.resize(image.size, Image.Resampling.BILINEAR)
    whole = np.asarray(image).astype(np.float32)
    rgb = level(whole)
    mask = np.asarray(model)[..., 3].astype(np.float32)[framing(whole)] / 255.0
    if not ((mask < 0.1).any() and (mask > 0.9).any()):
        raise ValueError("the model's answer is all clear or all solid")
    alpha, shape = cut_alpha(rgb, mask)
    rgba = np.dstack([unmix_white(rgb, alpha), alpha * 255]).astype(np.uint8)
    cut = Image.fromarray(rgba, "RGBA")
    bbox = cut.getbbox()
    if bbox is None:
        raise ValueError("the model found no pack")
    return cut.crop(bbox), shape


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.splitlines()[2].strip(), file=sys.stderr)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    photos = sorted(
        p for p in src.iterdir()
        if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and not p.name.endswith(".model.png")
    )
    report: dict[str, dict] = {}
    for path in photos:
        key = path.stem
        try:
            model_png = src / f"{key}.model.png"
            if not model_png.exists():
                raise FileNotFoundError("the model's cut-out is missing")
            cut, shape = cut_one(path, model_png)
            out = dst / f"{key}.png"
            cut.save(out, "PNG", optimize=True)
            report[key] = {
                "file": out.name,
                "width": cut.width,
                "height": cut.height,
                "shape": shape,
                "status": status_of(shape),
                "models": [MODEL],
                "version": VERSION,
            }
        except Exception as error:  # one bad photo must not stop the batch
            report[key] = {"error": f"{type(error).__name__}: {error}"}
        print(json.dumps({key: report[key]}), flush=True)
    (dst / "report.json").write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
