import { useId } from "react";
import { cx } from "@/components/ui/primitives";
import type { BrewingSystem } from "@/lib/recommend/systems";
import {
  CAPSULE_OUTLINES,
  type CapsuleOutline,
  type DiagramSystemId,
  sideFeaturePath,
  sideOutlinePath,
} from "./capsule-outlines";

export type { DiagramSystemId } from "./capsule-outlines";

/**
 * "Recognise your capsule" drawings.
 *
 * A visitor who does not know which system their machine takes usually has a
 * capsule in their hand, so the useful picture is one they can hold it up to.
 * These are our own line drawings — a side profile, plus a top view where the
 * outline from above is what separates the system — and are not derived from
 * any manufacturer's artwork.
 *
 * Three rules keep them honest:
 *
 * - The outlines are data, in millimetres (`capsule-outlines.ts`, which says
 *   where every figure comes from: a patent, a capsule manufacturer's
 *   dimensioned drawings, retailers' measurements, photographs). Every drawing
 *   is rendered at the same pixels per millimetre, so relative size is
 *   information: the Dolce Gusto capsule is the largest, A Modo Mio as wide as
 *   Lavazza Blue but much shallower.
 * - A dimension is printed only where it is established and cited there: each
 *   capsule's rim diameter and height, the ESE pod's 44 mm. The pod's
 *   thickness and the width of its paper edge are not established, so they
 *   are drawn but not printed.
 * - Nothing is drawn that we cannot stand behind. In particular no barcode,
 *   logo or surface marking appears on any of them.
 *
 * Every capsule is drawn the same way up — lid uppermost — so that the
 * silhouettes can be compared with one another.
 */

/*
 * The full plate. A side view is SIDE_WIDTH mm wide with the capsule's axis on
 * SIDE_AXIS, which leaves room on the right for the height dimension of the
 * widest capsule (Dolce Gusto); a top view is TOP_WIDTH wide, enough for the
 * ESE pod's paper edge. Side and top together are 136 mm, drawn at 2.35 px per
 * mm: 320 px, the width of the column the plates sit in.
 */
const SIDE_WIDTH = 76;
const SIDE_AXIS = 30;
const TOP_WIDTH = 60;
/** Rendered size of one millimetre, in rem. 0.146875rem is 2.35px. */
const UNIT_REM = 0.146875;
/** The rim sits this far down, under the diameter dimension. */
const RIM_Y = 11;
/** Room under the drawings for the view labels. */
const LABEL_SPACE = 8;
const FONT_SIZE = 4.8;

/*
 * The compact rendering is the side profile alone, in one box shared by every
 * system: wide enough for the pod's paper edge, tall enough for Dolce Gusto,
 * every base on the same line. 1.5 px per mm.
 */
const COMPACT_UNIT_REM = 0.09375;
/** Exported for the test that every outline fits it. */
export const COMPACT_FRAME = { width: 62, height: 38, axis: 31, base: 37.2 } as const;
const COMPACT_BOX = { width: COMPACT_FRAME.width, height: COMPACT_FRAME.height } as const;
const COMPACT_AXIS = COMPACT_FRAME.axis;
const COMPACT_BASE = COMPACT_FRAME.base;

/*
 * Stroke weights are in screen pixels (the strokes do not scale with the
 * drawing), which is what keeps the line weight identical between the large
 * and the compact rendering. The distinguishing feature is drawn heavier as
 * well as in the accent colour, so it does not depend on colour to be seen.
 */
const OUTLINE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinejoin: "round",
  strokeLinecap: "round",
  vectorEffect: "non-scaling-stroke",
} as const;

const BODY = { ...OUTLINE, className: "fill-paper-raised" } as const;

const FEATURE = {
  ...OUTLINE,
  strokeWidth: 3,
  className: "text-pine-700",
} as const;

const FINE = {
  ...OUTLINE,
  strokeWidth: 1,
  className: "text-ink-500",
} as const;

interface DiagramText {
  /** Accessible name, Bulgarian. */
  readonly label: string;
  /** Accessible description of what the drawing shows, Bulgarian. */
  readonly description: string;
}

const TEXT: Record<DiagramSystemId, DiagramText> = {
  "nespresso-original": {
    label: "Схема на капсула Nespresso Original",
    description:
      "Страничен профил в мащаб. Малка капсула с форма на пресечен конус: тънък навит ръб с диаметър 37 мм, права конусна стена и край, който се стеснява стъпаловидно до малко плоско дъно. Височина 28 мм.",
  },
  "dolce-gusto": {
    label: "Схема на капсула Dolce Gusto",
    description:
      "Страничен профил в мащаб. Най-широката от капсулите: ръб с диаметър 54 мм, къса права яка под него, стесняващо се надолу тяло и стъпаловидно дъно, което завършва с малък накрайник в средата. Височина 36 мм.",
  },
  "a-modo-mio": {
    label: "Схема на капсула Lavazza A Modo Mio",
    description:
      "Страничен профил в мащаб. Широка и плитка капсула: плосък ръб с диаметър 47 мм и ниско тяло с плоско дъно. Височина 17 мм.",
  },
  caffitaly: {
    label: "Схема на капсула Caffitaly",
    description:
      "Страничен профил в мащаб. Капсула с тънък ръб с диаметър 45 мм, почти прави стени с жлеб в долната част и заоблено дъно. Височина 27 мм.",
  },
  "lavazza-blue": {
    label: "Схема на капсула Lavazza Blue",
    description:
      "Страничен профил в мащаб. Ръб с диаметър 47 мм, колкото на A Modo Mio, над по-дълбоко тяло, което се стеснява надолу към плоско дъно. Височина 26 мм.",
  },
  "ese-pod": {
    label: "Схема на хартиена доза ESE",
    description:
      "Страничен профил и изглед отгоре. Плоска кръгла възглавничка от филтърна хартия: пресованото кафе в средата е 44 мм в диаметър, а хартиеният ръб около него е по-широк.",
  },
};

export function hasCapsuleDiagram(id: string): id is DiagramSystemId {
  return Object.hasOwn(CAPSULE_OUTLINES, id);
}

/** The accessible name a system's drawing carries when it is not decorative. */
export function capsuleDiagramLabel(id: DiagramSystemId): string {
  return TEXT[id].label;
}

function DimensionText({
  x,
  y,
  anchor = "middle",
  children,
}: {
  x: number;
  y: number;
  anchor?: "middle" | "start";
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={FONT_SIZE}
      fill="currentColor"
      className="text-ink-700"
    >
      {children}
    </text>
  );
}

/** A horizontal dimension line with end ticks. */
function HorizontalDimension({ from, to, y }: { from: number; to: number; y: number }) {
  return (
    <path
      {...FINE}
      d={`M${from} ${y}H${to}M${from} ${y - 1.5}V${y + 1.5}M${to} ${y - 1.5}V${y + 1.5}`}
    />
  );
}

/** A vertical dimension line with end ticks. */
function VerticalDimension({ x, from, to }: { x: number; from: number; to: number }) {
  return (
    <path
      {...FINE}
      d={`M${x} ${from}V${to}M${x - 1.5} ${from}H${x + 1.5}M${x - 1.5} ${to}H${x + 1.5}`}
    />
  );
}

function ViewLabel({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={FONT_SIZE}
      fill="currentColor"
      className="text-ink-500"
    >
      {children}
    </text>
  );
}

/** The side silhouette with its feature and bands, axis on x = 0, rim on y = 0. */
function SideProfile({ outline }: { outline: CapsuleOutline }) {
  return (
    <>
      <path {...BODY} d={sideOutlinePath(outline)} />
      {outline.bands?.map((band) => (
        <path key={band.y} {...FINE} d={`M${-band.r} ${band.y}H${band.r}`} />
      ))}
      <path {...FEATURE} d={sideFeaturePath(outline)} />
    </>
  );
}

/**
 * The drawing for one system, or nothing for a system with no capsule (beans).
 *
 * `variant="full"` is the field-guide plate: every view, labelled, with the
 * established dimensions. `variant="compact"` is the side profile alone, for
 * use inside a link that already names the system.
 *
 * `decorative` hides the drawing from assistive technology. Use it only where
 * the same element already announces the system by name and the drawing would
 * be read as noise — inside a wizard option, for instance.
 */
export function CapsuleDiagram({
  system,
  variant = "full",
  decorative = false,
  className,
}: {
  system: Pick<BrewingSystem, "id">;
  variant?: "full" | "compact";
  decorative?: boolean;
  className?: string;
}) {
  const id = useId();
  if (!hasCapsuleDiagram(system.id)) return null;
  const outline = CAPSULE_OUTLINES[system.id];
  const text = TEXT[system.id];
  const compact = variant === "compact";

  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  let box: { width: number; height: number };
  let unit: number;
  let views: React.ReactNode;

  if (compact) {
    box = COMPACT_BOX;
    unit = COMPACT_UNIT_REM;
    views = (
      <g transform={`translate(${COMPACT_AXIS} ${COMPACT_BASE - outline.height.mm})`}>
        <SideProfile outline={outline} />
      </g>
    );
  } else {
    const top = outline.top;
    const topDiameter = top ? top[0]!.r * 2 : 0;
    /*
     * Both views stand on one baseline, so a pod's flat profile sits level
     * with the bottom of its top view.
     */
    const base = Math.max(RIM_Y + outline.height.mm, top ? topDiameter + 1 : 0);
    const rimY = base - outline.height.mm;
    const rimRadius = outline.profile[0]!.points[1]![0];
    const labelY = base + 6.5;
    box = { width: SIDE_WIDTH + (top ? TOP_WIDTH : 0), height: base + LABEL_SPACE };
    unit = UNIT_REM;
    /* A capsule's rim diameter is printed over the side view; a pod's on top. */
    const sideDiameter = !top && outline.diameter.printed;
    const heightX = SIDE_AXIS + rimRadius + 2.5;

    views = (
      <>
        <g>
          <g transform={`translate(${SIDE_AXIS} ${rimY})`}>
            <SideProfile outline={outline} />
          </g>
          {sideDiameter && (
            <>
              <HorizontalDimension
                from={SIDE_AXIS - rimRadius}
                to={SIDE_AXIS + rimRadius}
                y={rimY - 3}
              />
              <DimensionText x={SIDE_AXIS} y={rimY - 6}>{`Ø ${sideDiameter}`}</DimensionText>
            </>
          )}
          {outline.height.printed && (
            <>
              <VerticalDimension x={heightX} from={rimY} to={base} />
              <DimensionText
                x={heightX + 1.8}
                y={rimY + outline.height.mm / 2 + 1.7}
                anchor="start"
              >
                {outline.height.printed}
              </DimensionText>
            </>
          )}
          <ViewLabel x={SIDE_AXIS} y={labelY}>
            отстрани
          </ViewLabel>
        </g>

        {top && (
          <g transform={`translate(${SIDE_WIDTH} 0)`}>
            {top.map((ring, index) => (
              <circle
                key={ring.r}
                {...(ring.feature ? FEATURE : index === 0 ? BODY : FINE)}
                cx={TOP_WIDTH / 2}
                cy={base - topDiameter / 2}
                r={ring.r}
              />
            ))}
            {outline.diameter.printed && (
              <>
                <HorizontalDimension
                  from={TOP_WIDTH / 2 - outline.diameter.mm / 2}
                  to={TOP_WIDTH / 2 + outline.diameter.mm / 2}
                  y={base - topDiameter / 2}
                />
                <DimensionText x={TOP_WIDTH / 2} y={base - topDiameter / 2 - 3}>
                  {outline.diameter.printed}
                </DimensionText>
              </>
            )}
            <ViewLabel x={TOP_WIDTH / 2} y={labelY}>
              отгоре
            </ViewLabel>
          </g>
        )}
      </>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${box.width} ${box.height}`}
      /*
       * A fixed width, not a fluid one: the drawings share a scale only as
       * long as each is rendered at the same size per millimetre.
       */
      style={{ width: `${box.width * unit}rem`, aspectRatio: `${box.width} / ${box.height}` }}
      className={cx("block h-auto max-w-full shrink-0 text-ink-700", className)}
      data-capsule-diagram={system.id}
      {...(decorative
        ? { "aria-hidden": true, focusable: false }
        : { role: "img", "aria-labelledby": titleId, "aria-describedby": descId })}
    >
      {!decorative && (
        <>
          <title id={titleId}>{text.label}</title>
          <desc id={descId}>{text.description}</desc>
        </>
      )}
      {views}
    </svg>
  );
}
