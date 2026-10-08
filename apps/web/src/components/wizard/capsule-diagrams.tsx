/*
 * The pragma is for the unit tests: Vitest compiles this file without Next's
 * compiler, and would otherwise fall back to the classic JSX transform and
 * look for a `React` global. Next already uses the automatic runtime.
 */
/** @jsxRuntime automatic */
import { useId } from "react";
import { cx } from "@/components/ui/primitives";
import type { BrewingSystem, BrewingSystemId } from "@/lib/recommend/systems";

/**
 * "Recognise your capsule" drawings.
 *
 * A visitor who does not know which system their machine takes usually has a
 * capsule in their hand, so the useful picture is one they can hold it up to.
 * These are our own schematic line drawings — a side profile, plus a top view
 * where the outline from above is what separates two systems — and are not
 * derived from any manufacturer's artwork.
 *
 * Three rules keep them honest:
 *
 * - Every drawing uses the same coordinate system, one unit to roughly one
 *   millimetre, and is rendered at the same pixels-per-unit. Relative size is
 *   therefore information: the Dolce Gusto capsule is visibly the widest.
 * - A dimension is printed only where the repository already states it (the
 *   Nespresso rim, the ESE pod). The other proportions are approximate, and a
 *   printed number would claim more than we know.
 * - Nothing is drawn that we cannot stand behind. In particular no barcode,
 *   logo or surface marking appears on any of them.
 *
 * Every capsule is drawn the same way up — lid uppermost — so that the
 * silhouettes can be compared with one another.
 */

/** Systems that come as a capsule or a pod, and so have a shape to draw. */
export type DiagramSystemId = Exclude<BrewingSystemId, "beans">;

/** One view occupies a fixed box, so every view shares one scale. */
const VIEW_WIDTH = 64;
const VIEW_HEIGHT = 64;
/** Rendered size of one drawing unit, in rem. 0.15625rem is 2.5px. */
const UNIT_REM = 0.15625;
const COMPACT_UNIT_REM = 0.09375;
/** The compact variant crops to the side profile alone. */
const COMPACT_BOX = { x: 3, y: 17, width: 58, height: 39 } as const;

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

interface DiagramDefinition {
  /** Accessible name, Bulgarian. */
  readonly label: string;
  /** Accessible description of what the drawing shows, Bulgarian. */
  readonly description: string;
  /**
   * Where the drawing starts, in units from the top of the view box. Cropping
   * the empty space above a short capsule keeps the plate close to its text;
   * it does not change the scale.
   */
  readonly top0: number;
  /** Side profile, drawn inside one view box with its base on y = 54. */
  readonly side: React.ReactNode;
  /** Top view, centred on (32, 29) of its own view box. */
  readonly top?: React.ReactNode;
  /** Printed dimensions; left out of the compact rendering. */
  readonly sideDimension?: React.ReactNode;
  readonly topDimension?: React.ReactNode;
}

function DimensionText({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={4.4}
      fill="currentColor"
      className="text-ink-700"
    >
      {children}
    </text>
  );
}

/** A horizontal dimension line with end ticks. */
function DimensionLine({ from, to, y }: { from: number; to: number; y: number }) {
  return (
    <path
      {...FINE}
      d={`M${from} ${y}H${to}M${from} ${y - 1.5}V${y + 1.5}M${to} ${y - 1.5}V${y + 1.5}`}
    />
  );
}

const DIAGRAMS: Record<DiagramSystemId, DiagramDefinition> = {
  "nespresso-original": {
    label: "Схема на капсула Nespresso Original",
    description:
      "Страничен профил и изглед отгоре. Малка капсула с форма на пресечен конус, който се стеснява към заоблен връх, и с тънък ръб с фолио на широкия край. Ръбът е около 37 мм в диаметър.",
    top0: 9,
    side: (
      <>
        <path
          {...BODY}
          d="M47 26.5L43.6 45Q43 49 38.5 52.5Q37 54 35 54H29Q27 54 25.5 52.5Q21 49 20.4 45L17 26.5Z"
        />
        <path
          {...FEATURE}
          d="M47 26.5L43.6 45Q43 49 38.5 52.5Q37 54 35 54H29Q27 54 25.5 52.5Q21 49 20.4 45L17 26.5"
        />
        <path {...OUTLINE} d="M13.5 26H50.5" />
      </>
    ),
    sideDimension: (
      <>
        <path {...FINE} d="M13.5 24.5V18.5M50.5 24.5V18.5" strokeDasharray="2 2" />
        <DimensionLine from={13.5} to={50.5} y={20} />
        <DimensionText x={32} y={17}>
          ≈ 37 мм
        </DimensionText>
      </>
    ),
    top: (
      <>
        <circle {...BODY} cx={32} cy={29} r={18.5} />
        <circle {...FINE} cx={32} cy={29} r={15} />
      </>
    ),
  },

  "dolce-gusto": {
    label: "Схема на капсула Dolce Gusto",
    description:
      "Страничен профил и изглед отгоре. Най-широката от капсулите: ниска пластмасова чашка с почти прави стени, плосък капак от фолио с широк ръб и малък накрайник в средата на дъното.",
    top0: 0,
    side: (
      <>
        <path
          {...BODY}
          d="M57 20L54.5 49Q54.3 52 51.3 52H36.5V54H27.5V52H12.7Q9.7 52 9.5 49L7 20Z"
        />
        <path {...FEATURE} d="M5 19.5H59" />
      </>
    ),
    top: (
      <>
        <circle {...BODY} cx={32} cy={29} r={27} />
        <circle {...FEATURE} cx={32} cy={29} r={25} />
      </>
    ),
  },

  "a-modo-mio": {
    label: "Схема на капсула Lavazza A Modo Mio",
    description:
      "Страничен профил. Малка ниска пластмасова капсула с плоско дъно и широк, плътен ръб отгоре, който стърчи встрани от тялото.",
    top0: 22,
    side: (
      <>
        <path
          {...BODY}
          d="M46.5 30V34H45.5L42.5 53Q42.4 54 41.4 54H22.6Q21.6 54 21.5 53L18.5 34H17.5V30Z"
        />
        <rect {...FEATURE} x={13} y={28} width={38} height={2} rx={0.6} />
      </>
    ),
  },

  caffitaly: {
    label: "Схема на капсула Caffitaly",
    description:
      "Страничен профил. Пластмасова капсула с форма на чашка със заоблено дъно и почти прави стени, с висок пръстен около горния край.",
    top0: 22,
    side: (
      <>
        <path {...BODY} d="M49 29L47.5 51Q47.3 54 44.3 54H19.7Q16.7 54 16.5 51L15 29Z" />
        <rect
          {...FEATURE}
          className="fill-paper-raised text-pine-700"
          x={13}
          y={24}
          width={38}
          height={5}
          rx={0.8}
        />
      </>
    ),
  },

  "lavazza-blue": {
    label: "Схема на капсула Lavazza Blue",
    description:
      "Страничен профил. Твърда пластмасова капсула, видимо по-висока от A Modo Mio, с плоско дъно и тесен ръб отгоре.",
    top0: 16,
    side: (
      <>
        <path {...BODY} d="M48 21.5L45 53Q44.9 54 43.9 54H20.1Q19.1 54 19 53L16 21.5Z" />
        <path {...FEATURE} d="M48 21.5L45 53Q44.9 54 43.9 54H20.1Q19.1 54 19 53L16 21.5" />
        <path {...OUTLINE} d="M13.5 20.8H50.5" />
      </>
    ),
  },

  "ese-pod": {
    label: "Схема на хартиена доза ESE",
    description:
      "Страничен профил и изглед отгоре. Плоска кръгла хартиена възглавничка с пресовано кафе в средата и тънък хартиен ръб около него; дозата е 44 мм в диаметър.",
    top0: 2,
    side: (
      <>
        <path {...OUTLINE} d="M7 49.5H57" />
        <path
          {...FEATURE}
          className="fill-paper-raised text-pine-700"
          d="M10 49.5Q32 40.5 54 49.5Q32 58.5 10 49.5Z"
        />
      </>
    ),
    top: (
      <>
        <circle {...BODY} cx={32} cy={29} r={25} />
        <circle {...FEATURE} cx={32} cy={29} r={22} />
      </>
    ),
    topDimension: (
      <>
        <DimensionLine from={10} to={54} y={29} />
        <DimensionText x={32} y={26}>
          44 мм
        </DimensionText>
      </>
    ),
  },
};

export function hasCapsuleDiagram(id: string): id is DiagramSystemId {
  return Object.hasOwn(DIAGRAMS, id);
}

/** The accessible name a system's drawing carries when it is not decorative. */
export function capsuleDiagramLabel(id: DiagramSystemId): string {
  return DIAGRAMS[id].label;
}

function ViewLabel({ x, children }: { x: number; children: string }) {
  return (
    <text
      x={x}
      y={62.5}
      textAnchor="middle"
      fontSize={4.4}
      fill="currentColor"
      className="text-ink-500"
    >
      {children}
    </text>
  );
}

/**
 * The drawing for one system, or nothing for a system with no capsule (beans).
 *
 * `variant="full"` is the field-guide plate: every view, labelled, with the
 * known dimension. `variant="compact"` is the side profile alone, for use
 * inside a link that already names the system.
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
  const diagram = DIAGRAMS[system.id];

  const compact = variant === "compact";
  const hasTop = !compact && diagram.top !== undefined;
  const box = compact
    ? COMPACT_BOX
    : {
        x: 0,
        y: diagram.top0,
        width: hasTop ? VIEW_WIDTH * 2 : VIEW_WIDTH,
        height: VIEW_HEIGHT - diagram.top0,
      };
  const unit = compact ? COMPACT_UNIT_REM : UNIT_REM;

  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      /*
       * A fixed width, not a fluid one: the drawings share a scale only as
       * long as each is rendered at the same size per unit.
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
          <title id={titleId}>{diagram.label}</title>
          <desc id={descId}>{diagram.description}</desc>
        </>
      )}

      <g>
        {diagram.side}
        {!compact && diagram.sideDimension}
        {!compact && <ViewLabel x={VIEW_WIDTH / 2}>отстрани</ViewLabel>}
      </g>

      {hasTop && (
        <g transform={`translate(${VIEW_WIDTH} 0)`}>
          {diagram.top}
          {diagram.topDimension}
          <ViewLabel x={VIEW_WIDTH / 2}>отгоре</ViewLabel>
        </g>
      )}
    </svg>
  );
}
