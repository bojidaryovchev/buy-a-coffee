import type { BrewingSystemId } from "@/lib/recommend/systems";
import {
  CAPSULE_OUTLINES,
  halfProfile,
  type CapsuleOutline,
  type DiagramSystemId,
  type Point,
} from "@/components/wizard/capsule-outlines";

/**
 * The small icon that marks a brewing system beside its name.
 *
 * Our own drawing, never the system owner's mark: most capsules in a system's
 * section are made by others to fit it, and Nestlé's or Lavazza's logo beside
 * them would claim an endorsement (PRODUCT.md). So the icon is the capsule
 * itself, computed from the same outlines the machine finder draws
 * (`capsule-outlines.ts`, in millimetres, with their sources), so the two can
 * never disagree:
 *
 * - A capsule is its side silhouette, lid up, scaled to the icon's width with
 *   its own proportions kept: A Modo Mio comes out shallow, Nespresso tall,
 *   Dolce Gusto with its stepped base and outlet.
 * - The ESE pod is its view from above, where it is told apart: the pressed
 *   coffee as a disc at its true radius, the paper edge as a ring at its own.
 * - Beans have no outline to derive from; their icon is a coffee bean drawn
 *   on the same grid in the same manner (a solid shape, its one feature — the
 *   crease — cut out of it).
 *
 * Every shape is solid, filled with the system's colour token by the
 * component (`system-icon.tsx`). It is decorative: the system's name is always
 * beside it.
 *
 * WHY THE FIGURES ARE ADJUSTED, AND ONLY THESE. Drawn on the icon's grid (one
 * unit is a pixel at the row size), a capsule's rim is 0.3 to 0.6 units thick
 * and would blur into nothing; it is thickened to one unit, downwards, so the
 * overhang that makes each capsule read as a capsule survives. Caffitaly's
 * groove is a line across the body in the drawing; here it is a one-unit gap.
 * Points closer than `TOLERANCE` to the line through their neighbours are
 * dropped (the outlines were written with straight corners for exactly this).
 * Nothing else is changed: widths, heights and the run of every wall are the
 * outline's.
 */

/**
 * The icon's design grid, one unit a pixel at the row size. Wider than tall
 * because every capsule is: fitted to 20 units across, the deepest of them
 * (Nespresso) is 15 tall, and the shallowest (A Modo Mio) still 7.
 */
export const ICON_BOX = { width: 20, height: 16 } as const;

/** The thinnest a rim, a ring or a cut is drawn, in grid units. */
const MIN_STROKE = 1;

/** Points nearer than this to the simplified outline are dropped, in units. */
const TOLERANCE = 0.3;

export interface SystemIconShape {
  /** One SVG path, every subpath closed; filled with `fill-rule: evenodd`. */
  readonly d: string;
  /** The ink's bounding box on the grid, for the tests. */
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/* --- Geometry helpers ---------------------------------------------------- */

function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker: keeps the points that carry the shape at this size. */
function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i]!, first, last);
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  const head = simplify(points.slice(0, index + 1), tolerance);
  const tail = simplify(points.slice(index), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/** Drops consecutive duplicates and points that sit on a straight run. */
function tidy(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (
      previous &&
      Math.abs(previous[0] - point[0]) < 1e-6 &&
      Math.abs(previous[1] - point[1]) < 1e-6
    )
      continue;
    out.push(point);
  }
  return out;
}

/**
 * Sutherland–Hodgman against one horizontal half-plane: keeps the part of a
 * closed polygon on one side of `y = edge`.
 */
function clipY(polygon: readonly Point[], edge: number, keepAbove: boolean): Point[] {
  const inside = ([, y]: Point) => (keepAbove ? y <= edge : y >= edge);
  const cross = ([ax, ay]: Point, [bx, by]: Point): Point => [
    ax + ((edge - ay) / (by - ay)) * (bx - ax),
    edge,
  ];
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!;
    const previous = polygon[(i + polygon.length - 1) % polygon.length]!;
    if (inside(current)) {
      if (!inside(previous)) out.push(cross(previous, current));
      out.push(current);
    } else if (inside(previous)) {
      out.push(cross(previous, current));
    }
  }
  return tidy(out);
}

function polygonPath(polygon: readonly Point[]): string {
  return `M${polygon.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`;
}

function boundsOf(points: readonly Point[]): SystemIconShape["bounds"] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: round(x), y: round(y), w: round(Math.max(...xs) - x), h: round(Math.max(...ys) - y) };
}

/* --- A capsule, from its side silhouette --------------------------------- */

/**
 * The half profile with the rim thickened to `minRim` millimetres: the rim's
 * underside and anything on the wall above it move down to it. The rim is the
 * outline's second to fourth points: out along the lid, down the rim's edge,
 * back in under it (`capsule-outlines.ts`, "Conventions").
 */
function thickenRim(half: readonly Point[], minRim: number): Point[] {
  const rimDepth = half[2]![1];
  if (rimDepth >= minRim) return [...half];
  return half.map(([x, y], index) => (index >= 2 && y < minRim ? [x, minRim] : [x, y]));
}

function capsuleShape(outline: CapsuleOutline): SystemIconShape {
  const scale = Math.min(ICON_BOX.width / outline.width, ICON_BOX.height / outline.height.mm);
  const half = thickenRim(halfProfile(outline), MIN_STROKE / scale).map(([x, y]): Point => [
    x * scale,
    y * scale,
  ]);
  const simplified = simplify(half, TOLERANCE);
  const height = outline.height.mm * scale;
  /* Centred on the grid, the lid on a whole unit so it lands on a pixel. */
  const top = Math.round((ICON_BOX.height - height) / 2);
  const axis = ICON_BOX.width / 2;
  const right = simplified.map(([x, y]): Point => [axis + x, top + y]);
  const left = [...simplified].reverse().map(([x, y]): Point => [axis - x, top + y]);
  const silhouette = tidy([...right, ...left]);

  /* A band (a groove) is cut through the body, one unit tall, centred on it. */
  let pieces: Point[][] = [silhouette];
  for (const band of outline.bands ?? []) {
    const middle = top + band.y * scale;
    const above = middle - MIN_STROKE / 2;
    const below = middle + MIN_STROKE / 2;
    pieces = pieces.flatMap((piece) =>
      [clipY(piece, above, true), clipY(piece, below, false)].filter((part) => part.length >= 3),
    );
  }

  return { d: pieces.map(polygonPath).join(""), bounds: boundsOf(silhouette) };
}

/* --- The ESE pod, from above --------------------------------------------- */

function circlePath(cx: number, cy: number, r: number): string {
  const R = round(r);
  return `M${round(cx - r)} ${round(cy)}a${R} ${R} 0 1 0 ${round(2 * r)} 0a${R} ${R} 0 1 0 ${round(-2 * r)} 0Z`;
}

function podShape(outline: CapsuleOutline): SystemIconShape {
  const rings = outline.top ?? [];
  const paper = rings[0]!.r;
  const coffee = (rings.find((ring) => ring.feature) ?? rings[0]!).r;
  const scale = ICON_BOX.height / (2 * paper);
  const cx = ICON_BOX.width / 2;
  const cy = ICON_BOX.height / 2;
  const outer = paper * scale;
  /* The paper edge as a ring at its own radius, the coffee as a disc at its. */
  const d =
    circlePath(cx, cy, outer) +
    circlePath(cx, cy, outer - MIN_STROKE) +
    circlePath(cx, cy, coffee * scale);
  return { d, bounds: { x: round(cx - outer), y: 0, w: round(2 * outer), h: ICON_BOX.height } };
}

/* --- A coffee bean ------------------------------------------------------- */

/*
 * A bean seen from its flat side, leaning right: an ellipse about as
 * proportioned as an arabica bean (roughly 7 : 10), split along its length by
 * the S-shaped crease, which is cut out one unit wide like Caffitaly's groove.
 */
const BEAN = { rx: 5.1, ry: 7.3, lean: 30, bend: 2.6 } as const;

function beanShape(): SystemIconShape {
  const { rx, ry, lean, bend } = BEAN;
  const gap = MIN_STROKE / 2;
  const angle = (lean * Math.PI) / 180;
  const place = ([x, y]: Point): Point => [
    ICON_BOX.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    ICON_BOX.height / 2 + x * Math.sin(angle) + y * Math.cos(angle),
  ];
  const p = (point: Point) => {
    const [x, y] = place(point);
    return `${round(x)} ${round(y)}`;
  };
  const tip = ry * Math.sqrt(1 - (gap / rx) ** 2);
  const half = (side: 1 | -1) => {
    const dx = side * gap;
    /* Down the outside of the bean, then back up along the crease. */
    return (
      `M${p([dx, -tip])}` +
      `A${rx} ${ry} ${lean} 0 ${side === 1 ? 1 : 0} ${p([dx, tip])}` +
      `C${p([dx + bend, ry / 3])} ${p([dx - bend, -ry / 3])} ${p([dx, -tip])}Z`
    );
  };
  const outline = Array.from({ length: 72 }, (_, i): Point => {
    const t = (i / 72) * 2 * Math.PI;
    return place([rx * Math.cos(t), ry * Math.sin(t)]);
  });
  return { d: half(1) + half(-1), bounds: boundsOf(outline) };
}

/* --- Every system -------------------------------------------------------- */

function shapeFor(id: DiagramSystemId): SystemIconShape {
  const outline = CAPSULE_OUTLINES[id];
  return outline.top ? podShape(outline) : capsuleShape(outline);
}

export const SYSTEM_ICONS: Record<BrewingSystemId, SystemIconShape> = {
  "nespresso-original": shapeFor("nespresso-original"),
  "dolce-gusto": shapeFor("dolce-gusto"),
  "a-modo-mio": shapeFor("a-modo-mio"),
  caffitaly: shapeFor("caffitaly"),
  "lavazza-blue": shapeFor("lavazza-blue"),
  "ese-pod": shapeFor("ese-pod"),
  beans: beanShape(),
};

export function systemIconShape(id: string): SystemIconShape | null {
  return Object.hasOwn(SYSTEM_ICONS, id) ? SYSTEM_ICONS[id as BrewingSystemId] : null;
}
