import Image from "next/image";
import { siteConfig } from "@/config/site";

/**
 * The wordmark.
 *
 * ⚠ WAS A DRAWN PLACEHOLDER, and the note it carried said why: "the brand is
 * not final, and a placeholder logo file would be harder to replace than a line
 * of markup". The brand is final now — `public/logo.png` is the real lockup —
 * so the drawn bean and the typeset name are both retired in its favour.
 *
 * It renders `logo-lockup.png` rather than `logo.png` directly. The supplied
 * artwork carries roughly 240px of transparent margin above and below the
 * lettering, which is invisible until something tries to size it: at
 * `h-8` the actual mark would occupy half that and sit off-centre in the
 * header. `pnpm brand:assets` trims it, and the same command cuts every icon
 * out of the same file, so nothing here can fall out of step with the favicon.
 *
 * Intrinsic size is the trimmed artwork's own 1579x402. Height is fixed in CSS
 * and the width follows, so the aspect is never the thing that breaks.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center ${className}`}>
      <Image
        src="/logo-lockup.png"
        alt={siteConfig.name}
        width={1579}
        height={402}
        /* The header is above the fold on every page and this is the only image
           in it, so it loads eagerly rather than costing a layout shift. */
        priority
        /**
         * ⚠ REQUIRED, not an optimisation. Without it Next sizes the srcSet
         * from the `width` prop and asks for `w=3840` — a 3840px raster of a
         * logo that renders 110px wide, fetched eagerly, in the header of every
         * page. `h-7` is 28px and the artwork is 1579:402, so 110px is the real
         * display width; this lets Next pick a 256px candidate for a 2x screen
         * instead. Move it if the header height moves.
         */
        sizes="110px"
        className="h-7 w-auto"
      />
    </span>
  );
}
