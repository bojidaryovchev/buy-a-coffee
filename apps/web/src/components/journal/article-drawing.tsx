import type { CSSProperties } from "react";
import { SystemIcon } from "@/components/catalog/system-icon";
import { Bean, Crema, Cup, Grounds } from "@/components/illustrations/drawings";
import { cx } from "@/components/ui/primitives";
import { CUP_COST_SLUG } from "../../../content/journal/articles/cup-cost";
import { FORMATS_SLUG } from "../../../content/journal/articles/formats";
import { INTENSITY_SLUG } from "../../../content/journal/articles/intensity";
import { ARABICA_ROBUSTA_SLUG, CHOOSE_BEANS_SLUG } from "../../../content/journal/articles/slugs";
import { WHICH_CAPSULE_SLUG } from "../../../content/journal/articles/which-capsule";

/**
 * A journal article's drawing (DESIGN.md, "Imagery"): one of our own, chosen
 * by what the article is about, over its card and its page. Decorative; the
 * title says what the article is. An article without one of its own gets the
 * glass of espresso.
 *
 * The capsules are our system drawings in neutral grey: a system's colour is
 * never shown without its name (DESIGN.md, "The Named Colour Rule").
 */
export function ArticleDrawing({ slug, className }: { slug: string; className?: string }) {
  const box = cx("flex h-20 items-end gap-3", className);
  switch (slug) {
    case CUP_COST_SLUG:
      return (
        <div aria-hidden className={box}>
          <Crema className="h-20 w-auto" />
        </div>
      );
    case WHICH_CAPSULE_SLUG:
      return (
        <div
          aria-hidden
          className={box}
          style={{ "--system": "var(--color-line-strong)" } as CSSProperties}
        >
          {(["nespresso-original", "dolce-gusto", "a-modo-mio"] as const).map((system) => (
            <SystemIcon key={system} systemId={system} size="lg" className="h-10 w-12.5" />
          ))}
        </div>
      );
    case INTENSITY_SLUG:
      return (
        <div aria-hidden className={box}>
          {[18, -12, 30, -4].map((turn, index) => (
            <span key={index} style={{ transform: `rotate(${turn}deg)` }} className="block w-7">
              <Bean roast={index % 2 ? "dark" : "medium"} className="block h-auto w-full" />
            </span>
          ))}
        </div>
      );
    case CHOOSE_BEANS_SLUG:
      return (
        <div aria-hidden className={box}>
          <Grounds className="h-20 w-auto" seed={11} count={48} />
        </div>
      );
    case ARABICA_ROBUSTA_SLUG:
      return (
        <div aria-hidden className={box}>
          <span className="block w-9 -rotate-12">
            <Bean className="block h-auto w-full" />
          </span>
          <span className="block w-8 rotate-[24deg]">
            <Bean roast="dark" className="block h-auto w-full" />
          </span>
        </div>
      );
    case FORMATS_SLUG:
    default:
      return (
        <div aria-hidden className={box}>
          <Cup className="h-20 w-auto" />
        </div>
      );
  }
}
