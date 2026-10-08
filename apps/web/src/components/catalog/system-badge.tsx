import Link from "next/link";
import { getBrewingSystem } from "@/lib/recommend/systems";

/**
 * Names the brewing system a product belongs to.
 *
 * The most important label in the shop: it answers "does this go in my
 * machine?" Specified in DESIGN.md, "System badge".
 *
 * Colour comes from `data-system`, which `globals.css` turns into `--system`
 * and `--system-wash`; Tailwind cannot generate a class from a runtime id. The
 * swatch is never shown without the name — colour alone tells nobody anything,
 * and tells a colour-blind visitor less.
 *
 * Renders nothing for an unknown or absent system: a badge is a compatibility
 * claim, and no claim is better than a guessed one.
 */
export function SystemBadge({
  systemId,
  size = "sm",
  href,
}: {
  readonly systemId: string | null | undefined;
  /** `sm` on cards and rows, `md` on the product page and listing headers. */
  readonly size?: "sm" | "md";
  /** Set where the badge should link to the system's listing. */
  readonly href?: string;
}) {
  const system = getBrewingSystem(systemId);
  if (!system) return null;

  const className = [
    "inline-flex max-w-full items-center gap-1.5 rounded-xs bg-(--system-wash) px-1.5 text-(--system)",
    size === "md" ? "min-h-6 text-xs" : "min-h-5 text-2xs",
    href ? "underline-offset-4 hover:underline" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 bg-(--system)" />
      <span className="truncate font-semibold">{system.name}</span>
    </>
  );

  return href ? (
    <Link href={href} data-system={system.id} className={className}>
      {content}
    </Link>
  ) : (
    <span data-system={system.id} className={className}>
      {content}
    </span>
  );
}
