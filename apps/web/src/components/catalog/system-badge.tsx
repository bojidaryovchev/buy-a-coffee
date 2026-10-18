import Link from "next/link";
import { getBrewingSystem } from "@/lib/recommend/systems";
import { SystemIcon } from "./system-icon";

/**
 * Names the brewing system a product belongs to.
 *
 * The most important label in the shop: it answers "does this go in my
 * machine?" Specified in DESIGN.md, "System badge".
 *
 * Colour comes from `data-system`, which `globals.css` turns into `--system`
 * and `--system-wash`; Tailwind cannot generate a class from a runtime id. The
 * system's icon (our own capsule outline, `system-icon.tsx`) is never shown
 * without the name — a shape and a colour alone tell nobody anything.
 *
 * Renders nothing for an unknown or absent system: a badge is a compatibility
 * claim, and no claim is better than a guessed one.
 */
export function SystemBadge({
  systemId,
  size = "sm",
  href,
  target = "grow",
}: {
  readonly systemId: string | null | undefined;
  /** `sm` on cards and rows, `md` on the product page and listing headers. */
  readonly size?: "sm" | "md";
  /** Set where the badge should link to the system's listing. */
  readonly href?: string;
  /**
   * How a linked badge becomes a 44 px touch target below `lg`: it `grow`s
   * (a line of its own, the product page's brand line), or, where growing
   * would push the row apart (a table cell beside its label), it takes
   * vertical `pad`ding that a negative margin hands back to the layout.
   */
  readonly target?: "grow" | "pad";
}) {
  const system = getBrewingSystem(systemId);
  if (!system) return null;

  const badge = [
    "inline-flex max-w-full items-center rounded-xs bg-(--system-wash) px-1.5 text-(--system)",
    // The small badge spends 4 px, not 6, between icon and name: on a 320 px
    // phone's card it has 112 px, and every pixel goes to the name.
    size === "md" ? "min-h-6 gap-1.5 text-xs" : "min-h-5 gap-1 text-2xs",
  ].join(" ");

  const content = (
    <>
      <SystemIcon systemId={system.id} size={size === "md" ? "md" : "sm"} />
      <span
        className={`truncate font-semibold${href ? " underline-offset-4 group-hover:underline" : ""}`}
      >
        {system.name}
      </span>
    </>
  );

  if (!href) {
    return (
      <span data-system={system.id} className={badge}>
        {content}
      </span>
    );
  }

  /*
   * A link is a touch target: 44 px tall below `lg` (DESIGN.md, "The Touch
   * Target Rule"). The link takes the height and the badge keeps its own, so
   * the label looks the same everywhere and only what a finger can hit grows.
   */
  return (
    <Link
      href={href}
      data-system={system.id}
      className={`group inline-flex max-w-full items-center rounded-xs ${
        target === "grow" ? "min-h-11 lg:min-h-6" : "-my-2.5 py-2.5 lg:my-0 lg:py-0"
      }`}
    >
      <span className={badge}>{content}</span>
    </Link>
  );
}
