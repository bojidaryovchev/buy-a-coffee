import type { BrewingSystemId } from "@/lib/recommend/systems";

/**
 * The capsule outlines, as data, in millimetres.
 *
 * This is what the "recognise your capsule" drawings are built from, and what
 * a small system icon can later be derived from without redrawing anything:
 * every outline is in one unit (1 = 1 mm), so relative size survives any
 * scaling that is applied to all of them alike.
 *
 * Conventions:
 *
 * - A capsule is drawn lid up. `x` is the distance from the capsule's axis,
 *   `y` the distance down from the top of the rim (the lid's plane).
 * - `profile` is the right half of the side silhouette, from the centre of the
 *   lid, out along the rim, down the outside and in to the centre of the base.
 *   It is mirrored about the axis for the full outline (`sideOutlinePath`).
 *   Every capsule here is a solid of revolution, so the half is enough.
 * - Runs marked `feature` are the part that tells the system apart from its
 *   nearest look-alike; the drawing emphasises them.
 * - Corners are straight segments, not curves, so that the same points can be
 *   simplified for a 16 px icon by dropping points rather than refitting.
 *
 * Where the figures come from. No system owner publishes its capsule's
 * dimensions, so each outline is taken from the best evidence there is:
 *
 * - [KDE] Koninklijke Douwe Egberts, US 11,198,557 B2, "Capsule, a system for
 *   preparing a potable beverage…": an aluminium capsule for the Nespresso
 *   Original machines it names (Citiz, Lattissima, U, Maestria, Pixie, Inissia,
 *   Essenza). Flange outer diameter about 37.1 mm, open end about 29.5 mm
 *   inside, total height about 28.4 mm, side wall at about 97.5° to the
 *   transverse plane, a truncated bottom 4.0 mm high from about 23.3 mm down to
 *   a flat centre about 8.3 mm across, curled flange edge about 1.2 mm.
 * - [IMPER] Imper S.p.A. (a capsule manufacturer), technical data sheets for
 *   its capsules compatible with each system, with dimensioned drawings
 *   (imperspa.it, product pages, read 18 October 2026). A compatible capsule
 *   has to match the original's outside to seat in the machine, so its outline
 *   is the original's to within the manufacturer's tolerance. Diameter and
 *   height as printed: Nespresso 36.90 × 28.60, Dolce Gusto Ø53.90 (drawing) ×
 *   36.24, A Modo Mio 47.10 × 17.40 (±0.10), Lavazza Blue 47.15 (±0.25) × 25.90
 *   (±0.15), Caffitaly 45.00 × 26.60. The intermediate radii below were
 *   measured off those drawings, scaled to the printed diameter; they are good
 *   to a few tenths of a millimetre and are not printed anywhere.
 * - [CCD] Coffee Capsules Direct, "A complete guide to compatible coffee
 *   capsules and which machines they fit" (27 March 2017), a retailer's
 *   measured figures: Nespresso ≈37 × 30, Dolce Gusto ≈54 × 36, A Modo Mio ≈47 ×
 *   17, Caffitaly ≈45 × 25, Lavazza Blue ≈47 × 27, ESE 44.
 * - [PASCUCCI] Caffè Pascucci, A Modo Mio-compatible capsule: 4.7 cm at the
 *   top, 3.4 cm at the bottom, 1.7 cm high.
 * - [KICKKICK] Kickkick.it, Lavazza Blue capsules: about 47 mm across, 27 mm
 *   high, conical.
 * - [DELONGHI] De'Longhi, "What are ESE pods?": typically 44 mm in diameter,
 *   seven grams of coffee.
 * - [ILLY] Ernesto Illy, US 4,254,694 (1981), the pod patent the ESE standard
 *   grew from: pods about 35–50 mm across and 5 to about 13 mm thick.
 * - Photographs looked at for the profile, not only the numbers: Wikimedia
 *   Commons "CaffitaCapsules.jpg" and "Cafissimo-Kapsel.jpg" (Caffitaly-system
 *   capsules, side on), "Used LB coffee capsules.jpg" (Lavazza Blue),
 *   "Dolcegusto capsule w annotations.jpg" (a Dolce Gusto capsule cut open:
 *   film lid, plastic hull, outlet in the base), "Nespresso-capsules AB-01.jpg"
 *   and "User Nespresso pod.jpg" (Nespresso Original), "Pad ESE mit
 *   Siebtraeger.jpg" (an ESE pod beside a ruler: the pressed coffee measures
 *   about 44–45 mm, the paper around it about 59 mm and irregular); and our
 *   own packshots, which show A Modo Mio and compatible Lavazza Blue capsules.
 *
 * Where sources disagree the drawing follows the dimensioned drawing or
 * patent over the rounded retail figure, and the plate prints whole
 * millimetres: Nespresso height 28.4 [KDE] / 28.6 [IMPER] / ≈30 [CCD] → 28;
 * Lavazza Blue height 25.9 [IMPER] / ≈27 [CCD, KICKKICK] → 26; Caffitaly
 * height 26.6 [IMPER] / ≈25 [CCD] (two Italian buying guides say 31) → 27.
 * Two things are not established and are therefore not printed: the
 * thickness of an ESE pod (drawn at 9 mm, inside the 5–13 mm range of [ILLY])
 * and the diameter of its paper edge (drawn at 59 mm from the one measured
 * photograph).
 */

/** Systems that come as a capsule or a pod, and so have a shape to draw. */
export type DiagramSystemId = Exclude<BrewingSystemId, "beans">;

/** A point in millimetres: distance from the axis, distance below the rim. */
export type Point = readonly [x: number, y: number];

export interface ProfileRun {
  readonly points: readonly Point[];
  /** Part of what distinguishes the system; drawn heavier, in the accent. */
  readonly feature?: boolean;
}

export interface Measurement {
  /** The figure the outline is built on, in millimetres. */
  readonly mm: number;
  /**
   * What the drawing prints, when the figure is established well enough to
   * print. Left out where it is not; the outline still uses `mm`.
   */
  readonly printed?: string;
}

export interface TopRing {
  /** Radius in millimetres. */
  readonly r: number;
  readonly feature?: boolean;
}

export interface CapsuleOutline {
  /** Across the widest part seen from the side (the rim, or the pod's paper). */
  readonly width: number;
  /** The rim, or for the pod the pressed coffee: the diameter people quote. */
  readonly diameter: Measurement;
  readonly height: Measurement;
  /** Right half of the side silhouette; see the module comment. */
  readonly profile: readonly ProfileRun[];
  /** Lines across the body where the outline steps (a rib, a groove). */
  readonly bands?: readonly { readonly y: number; readonly r: number }[];
  /**
   * The view from above, where it is what tells the system apart: concentric
   * rings, outermost first.
   */
  readonly top?: readonly TopRing[];
}

export const CAPSULE_OUTLINES: Record<DiagramSystemId, CapsuleOutline> = {
  /*
   * Nespresso Original. [KDE] for every figure; [IMPER] 36.90 × 28.60 and
   * [CCD] ≈37 agree on the rim. The photographs show the same thing: a thin
   * rolled rim, a straight cone, and a faceted end that steps in to a small
   * flat centre.
   */
  "nespresso-original": {
    width: 37.1,
    diameter: { mm: 37.1, printed: "37 мм" },
    height: { mm: 28.4, printed: "28 мм" },
    profile: [
      {
        points: [
          [0, 0],
          [18.55, 0],
          [18.55, 1.2],
          [14.85, 1.2],
        ],
      },
      {
        feature: true,
        points: [
          [14.85, 1.2],
          [11.75, 24.4],
          [4.15, 28.4],
          [0, 28.4],
        ],
      },
    ],
  },

  /*
   * Dolce Gusto. [IMPER] drawing: Ø53.90 flange, a short straight collar, a
   * tapering body, then a stepped base that ends in the outlet nozzle; 36.24
   * overall. [CCD] ≈54 × 36. The cut-open photograph shows the same base: the
   * outlet sits at the bottom, under a film lid at the top.
   */
  "dolce-gusto": {
    width: 53.9,
    diameter: { mm: 53.9, printed: "54 мм" },
    height: { mm: 36.24, printed: "36 мм" },
    profile: [
      {
        points: [
          [0, 0],
          [26.95, 0],
          [26.95, 0.6],
          [23.9, 0.6],
          [23.9, 3.9],
          [23.0, 5.1],
          [22.8, 5.6],
          [18.7, 26.6],
        ],
      },
      {
        feature: true,
        points: [
          [18.7, 26.6],
          [14.8, 26.6],
          [14.2, 27.6],
          [13.8, 29.0],
          [12.1, 30.4],
          [10.6, 31.4],
          [6.0, 31.4],
          [6.0, 32.9],
          [4.4, 32.9],
          [4.4, 34.9],
          [2.85, 34.9],
          [2.85, 36.24],
          [0, 36.24],
        ],
      },
    ],
  },

  /*
   * Lavazza A Modo Mio. [IMPER] 47.10 × 17.40, [PASCUCCI] 47 / 34 / 17,
   * [CCD] ≈47 × 17: a wide, shallow cup under a flat rim — as wide as a
   * Lavazza Blue capsule and two-thirds as tall. The shallowness is the tell.
   */
  "a-modo-mio": {
    width: 47.1,
    diameter: { mm: 47.1, printed: "47 мм" },
    height: { mm: 17.4, printed: "17 мм" },
    profile: [
      {
        points: [
          [0, 0],
          [23.55, 0],
          [23.55, 0.9],
          [20.35, 0.9],
        ],
      },
      {
        feature: true,
        points: [
          [20.35, 0.9],
          [20.35, 3.4],
          [19.1, 4.6],
          [18.07, 14.1],
          [17.4, 15.3],
          [17.1, 16.9],
          [16.4, 17.3],
          [15.8, 17.4],
          [0, 17.4],
        ],
      },
    ],
  },

  /*
   * Caffitaly. [IMPER] 45.00 × 26.60, [CCD] ≈45 × 25. A thin rim over a short
   * collar, nearly straight walls with a groove low on the body, and a
   * rounded base; the photographs of Caffitaly and Tchibo Cafissimo capsules
   * show the groove and the rounded base, in black, blue or orange.
   */
  caffitaly: {
    width: 45,
    diameter: { mm: 45, printed: "45 мм" },
    height: { mm: 26.6, printed: "27 мм" },
    profile: [
      {
        points: [
          [0, 0],
          [22.5, 0],
          [22.5, 0.6],
          [20.2, 0.6],
        ],
      },
      {
        feature: true,
        points: [
          [20.2, 0.6],
          [19.4, 1.1],
          [19.4, 4.1],
          [18.95, 5.0],
          [17.4, 17.4],
          [17.2, 18.2],
          [16.4, 24.2],
          [15.8, 25.5],
          [14.5, 26.35],
          [13.5, 26.6],
          [0, 26.6],
        ],
      },
    ],
    bands: [{ y: 17.4, r: 17.4 }],
  },

  /*
   * Lavazza Blue. [IMPER] 47.15 × 25.90, [CCD] and [KICKKICK] ≈47 × 27. The
   * same rim as A Modo Mio on a deeper, tapering tub with a flat base.
   */
  "lavazza-blue": {
    width: 47.15,
    diameter: { mm: 47.15, printed: "47 мм" },
    height: { mm: 25.9, printed: "26 мм" },
    profile: [
      {
        points: [
          [0, 0],
          [23.575, 0],
          [23.575, 0.6],
          [20.44, 0.6],
        ],
      },
      {
        feature: true,
        points: [
          [20.44, 0.6],
          [20.44, 3.3],
          [19.4, 4.3],
          [17.86, 18.4],
          [17.13, 22.1],
          [16.6, 24.2],
          [15.7, 25.4],
          [14.6, 25.9],
          [0, 25.9],
        ],
      },
    ],
  },

  /*
   * ESE pod. 44 mm is the pressed coffee [DELONGHI, CCD], which the measured
   * photograph confirms; the paper around it is wider and irregular (about
   * 59 mm in that photograph, not printed). The thickness is not established
   * (see the module comment) and is not printed.
   */
  "ese-pod": {
    width: 59,
    diameter: { mm: 44, printed: "44 мм" },
    height: { mm: 9 },
    profile: [
      {
        feature: true,
        points: [
          [0, 0],
          [16, 0],
          [19.5, 0.6],
          [21.4, 2],
          [22, 4.5],
        ],
      },
      {
        points: [
          [22, 4.5],
          [29.5, 4.5],
          [22, 4.5],
        ],
      },
      {
        feature: true,
        points: [
          [22, 4.5],
          [21.4, 7],
          [19.5, 8.4],
          [16, 9],
          [0, 9],
        ],
      },
    ],
    top: [{ r: 29.5 }, { r: 22, feature: true }],
  },
};

export function capsuleOutline(id: DiagramSystemId): CapsuleOutline {
  return CAPSULE_OUTLINES[id];
}

const round = (value: number) => Math.round(value * 100) / 100;

function pointList(points: readonly Point[], mirror: boolean): string {
  return points.map(([x, y]) => `${round(mirror ? -x : x)} ${round(y)}`).join("L");
}

/** The right half of the side silhouette, as one list of points. */
export function halfProfile(outline: CapsuleOutline): Point[] {
  return outline.profile.flatMap((run) => run.points);
}

/**
 * The full side silhouette as a closed SVG path, in millimetres, with the
 * axis on x = 0 and the top of the rim on y = 0.
 */
export function sideOutlinePath(outline: CapsuleOutline): string {
  const half = halfProfile(outline);
  const left = [...half].reverse();
  return `M${pointList(half, false)}L${pointList(left, true)}Z`;
}

/** The feature runs, each with its mirror image, as open SVG subpaths. */
export function sideFeaturePath(outline: CapsuleOutline): string {
  return outline.profile
    .filter((run) => run.feature)
    .map((run) => `M${pointList(run.points, false)}M${pointList(run.points, true)}`)
    .join("");
}
