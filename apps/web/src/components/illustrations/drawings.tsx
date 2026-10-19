import { useId } from "react";
import { Ambient } from "./ambient";

/** Class names, joined; kept here so the primitives can draw these without an import cycle. */
const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/**
 * Our own drawings — DESIGN.md, "Imagery". Inline SVG in the drawing tones
 * (`illo-*`), flat shapes in a few layers, decorative (`aria-hidden`) and never
 * an LCP candidate. Each is a few hundred bytes; `test/illustrations.test.ts`
 * holds them to that and to their colours.
 *
 * They are server components: nothing here runs in the browser except the
 * steam's off-screen pause (`Ambient`).
 */

type DrawingProps = { readonly className?: string };

const svgProps = (name: string, viewBox: string, className?: string) => ({
  viewBox,
  "aria-hidden": true,
  focusable: false,
  "data-illustration": name,
  className,
});

/* --- The curl ------------------------------------------------------------- */

/**
 * The mark's own device: the crease of the bean in the logo rising into steam.
 * Drawn in `currentColor`, so the caller picks gold on pine, ink on paper.
 */
export const CURL_PATH = "M30 148C4 124 56 108 30 80C8 56 52 42 34 18C28 10 30 4 36 0";

export function Curl({ className, strokeWidth = 5 }: DrawingProps & { strokeWidth?: number }) {
  return (
    <svg {...svgProps("curl", "0 0 60 150", className)}>
      <path
        d={CURL_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}

/* --- Steam ---------------------------------------------------------------- */

const WISPS = [
  "M18 46C10 36 26 30 18 18C14 12 18 6 20 2",
  "M30 46C22 36 38 30 30 18C26 12 30 6 32 2",
  "M42 46C34 36 50 30 42 18C38 12 42 6 44 2",
];

/** Three wisps that rise and fade in turn (`.steam-wisp`), in `currentColor`. */
function Wisps({ strokeWidth = 3 }: { strokeWidth?: number }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
      {WISPS.map((d) => (
        <path key={d} d={d} className="steam-wisp" />
      ))}
    </g>
  );
}

export function Steam({ className }: DrawingProps) {
  return (
    <Ambient className={className}>
      <svg {...svgProps("steam", "0 0 60 48", "block h-auto w-full overflow-visible")}>
        <Wisps />
      </svg>
    </Ambient>
  );
}

/* --- A bean --------------------------------------------------------------- */

const BEAN = {
  body: "M20 2C32 2 38 15 38 29C38 44 30 54 20 54C9 54 2 43 2 28C2 14 9 2 20 2Z",
  sheen: "M11 10C6.5 16 5.5 25 7.5 34",
  crease: "M21.5 5C14 15 14.5 22 19.5 29C24.5 36 24 45 18 52",
};

/** A roasted bean, 40 by 56. `dark` is the darker roast. */
export function Bean({
  className,
  roast = "medium",
}: DrawingProps & { roast?: "medium" | "dark" }) {
  const dark = roast === "dark";
  return (
    <svg {...svgProps("bean", "0 0 40 56", className)}>
      <path d={BEAN.body} className={dark ? "fill-illo-bean-700" : "fill-illo-bean-500"} />
      <path
        d={BEAN.sheen}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className={dark ? "stroke-illo-bean-500" : "stroke-illo-bean-300"}
      />
      <path
        d={BEAN.crease}
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
        className={dark ? "stroke-black/60" : "stroke-illo-bean-700"}
      />
    </svg>
  );
}

/* --- An espresso glass ---------------------------------------------------- */

/**
 * An espresso in a glass on its saucer, seen from the side, 120 by 120.
 *
 * - `ground`: what it stands on. On `dark` (pine, espresso) the glass is drawn
 *   in light strokes; on `light` (paper) in hairline strokes.
 * - `steam`: three wisps over the rim, paused off-screen.
 * - `pour`: the coffee rises into the glass once (`.cup-pour`), for „order
 *   sent“. Without it the glass is simply full.
 */
export function Cup({
  className,
  ground = "light",
  steam = false,
  pour = false,
}: DrawingProps & { ground?: "light" | "dark"; steam?: boolean; pour?: boolean }) {
  const clip = `cup-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const dark = ground === "dark";
  const glass = dark ? "stroke-paper-raised/80" : "stroke-line-strong";
  const drawing = (
    <svg
      {...svgProps(
        "cup",
        "0 0 120 120",
        cx("block h-auto w-full overflow-visible", !steam && className),
      )}
    >
      <defs>
        <clipPath id={clip}>
          <path d="M23 52H97V66C97 86 82 99 60 99C38 99 23 86 23 66Z" />
        </clipPath>
      </defs>
      {steam && (
        <g
          transform="translate(30 0)"
          className={dark ? "text-paper-raised/70" : "text-line-strong"}
        >
          <Wisps />
        </g>
      )}
      <ellipse
        cx="60"
        cy="113"
        rx="54"
        ry="5"
        className={dark ? "fill-black/35" : "fill-ink-900/10"}
      />
      <ellipse
        cx="60"
        cy="106"
        rx="50"
        ry="7"
        className={cx("fill-paper-raised", !dark && "stroke-line")}
        strokeWidth="1.5"
      />
      <path
        d="M98 62c15 0 16 21 -1 23"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        className={glass}
      />
      <g clipPath={`url(#${clip})`}>
        <g className={pour ? "cup-pour" : undefined}>
          <rect x="20" y="62" width="80" height="44" className="fill-illo-bean-700" />
          <rect x="20" y="56" width="80" height="7" className="fill-illo-crema" />
        </g>
      </g>
      <path
        d="M20 50H100V66C100 88 84 102 60 102C36 102 20 88 20 66Z"
        strokeWidth="2.5"
        className={cx("fill-paper-raised/15", glass)}
      />
      <ellipse cx="60" cy="50" rx="40" ry="5" fill="none" strokeWidth="2.5" className={glass} />
      <path
        d="M29 58V68C29 78 33 86 40 91"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-paper-raised/50"
      />
    </svg>
  );
  return steam ? <Ambient className={className}>{drawing}</Ambient> : drawing;
}

/* --- Crema, from above ------------------------------------------------------ */

/** A cup of espresso seen from above on its saucer, 140 by 120. */
export function Crema({ className }: DrawingProps) {
  return (
    <svg {...svgProps("crema", "0 0 140 120", className)}>
      <circle cx="64" cy="60" r="56" strokeWidth="1.5" className="fill-paper-raised stroke-line" />
      <rect
        x="106"
        y="52"
        width="32"
        height="16"
        rx="6"
        strokeWidth="1.5"
        className="fill-paper-raised stroke-line"
      />
      <circle cx="64" cy="60" r="38" strokeWidth="2" className="fill-paper stroke-line" />
      <circle cx="64" cy="60" r="32" className="fill-illo-crema" />
      <circle
        cx="64"
        cy="60"
        r="29.5"
        fill="none"
        strokeWidth="5"
        className="stroke-illo-bean-300/50"
      />
      <path
        d="M84 56C86 72 70 82 58 76C46 70 50 56 62 56C70 56 70 64 64 66"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-paper-raised/70"
      />
    </svg>
  );
}

/* --- A cup ring ------------------------------------------------------------- */

/** The mark a cup leaves on paper, 200 by 200, in the stain tone. */
export function CupRing({ className }: DrawingProps) {
  return (
    <svg {...svgProps("cup-ring", "0 0 200 200", className)}>
      {/* As coffee dries: a faint wash inside, the colour gathered at the
          rim — a thin band and a crisper, broken edge — never a soft wide rim,
          which reads as a plate. */}
      <circle cx="100" cy="100" r="76" className="fill-illo-stain/4" />
      <circle
        cx="100"
        cy="100"
        r="75"
        fill="none"
        strokeWidth="3"
        className="stroke-illo-stain/12"
      />
      <circle
        cx="101"
        cy="99"
        r="77"
        fill="none"
        strokeWidth="1.5"
        strokeDasharray="170 30 95 22 150 18"
        className="stroke-illo-stain/30"
      />
      <path
        d="M32 126C44 162 92 184 132 172"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-illo-stain/15"
      />
      <circle cx="170" cy="44" r="5" className="fill-illo-stain/20" />
      <circle cx="182" cy="58" r="2.5" className="fill-illo-stain/20" />
    </svg>
  );
}

/* --- A spill ---------------------------------------------------------------- */

const SPILL =
  "M70 24C102 8 150 14 176 34C204 56 226 60 222 84C218 108 186 104 164 118C140 134 96 136 66 122C36 108 12 98 16 72C20 48 44 37 70 24Z";

/** Spilled coffee, 240 by 140: for the moments nothing is there. */
export function Spill({ className }: DrawingProps) {
  return (
    <svg {...svgProps("spill", "0 0 240 140", className)}>
      <path d={SPILL} className="fill-illo-bean-700" />
      <path d={SPILL} fill="none" strokeWidth="2" className="stroke-illo-bean-300/60" />
      <path
        d="M76 38C98 28 132 28 152 38"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-paper-raised/25"
      />
      <circle cx="206" cy="26" r="6" className="fill-illo-bean-700" />
      <circle cx="222" cy="40" r="3" className="fill-illo-bean-700" />
      <circle cx="26" cy="126" r="4" className="fill-illo-bean-700" />
    </svg>
  );
}

/* --- Grounds ---------------------------------------------------------------- */

const GROUND_TONES = ["fill-illo-bean-700", "fill-illo-bean-500", "fill-illo-bean-300"];

/**
 * A fine scatter of grounds, 200 by 140, from a fixed seed: the same drawing on
 * every render, so server and browser agree and nothing changes between visits.
 */
export function Grounds({
  className,
  seed = 7,
  count = 60,
}: DrawingProps & { seed?: number; count?: number }) {
  let state = seed;
  const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const dots = Array.from({ length: count }, (_, index) => {
    const angle = next() * Math.PI * 2;
    const radius = Math.pow(next(), 0.6) * 62;
    return {
      cx: (100 + Math.cos(angle) * radius * 1.35).toFixed(1),
      cy: (70 + Math.sin(angle) * radius * 0.8).toFixed(1),
      r: (0.8 + next() * 1.8).toFixed(1),
      tone: GROUND_TONES[index % GROUND_TONES.length],
    };
  });
  return (
    <svg {...svgProps("grounds", "0 0 200 140", className)}>
      {dots.map((dot, index) => (
        <circle key={index} cx={dot.cx} cy={dot.cy} r={dot.r} className={dot.tone} />
      ))}
    </svg>
  );
}
