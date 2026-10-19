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
 * It renders `logo.svg`: the lockup traced from `logo-lockup.png` (Phase K,
 * K2), sharp on a 3× screen where the 256 px raster went soft, and 6.8 KB
 * gzipped against the raster's 3.4 KB. The PNGs stay for what cannot take an
 * SVG — share cards, email, the PWA icons — and `pnpm brand:assets` still cuts
 * those from `logo.png`.
 *
 * Intrinsic size is the artwork's own 1579x402. Height is fixed in CSS and the
 * width follows, so the aspect is never the thing that breaks. `unoptimized`:
 * the image optimizer rasterises nothing here, it serves the file as it is.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center ${className}`}>
      <Image
        src="/logo.svg"
        alt={siteConfig.name}
        width={1579}
        height={402}
        unoptimized
        /* The header is above the fold on every page and this is the only image
           in it, so it loads eagerly rather than costing a layout shift. */
        priority
        className="h-7 w-auto"
      />
    </span>
  );
}
