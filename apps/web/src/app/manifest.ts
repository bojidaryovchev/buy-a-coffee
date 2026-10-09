import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { DEFAULT_LOCALE, HTML_LANG } from "@/i18n/config";
import { href, routes } from "@/lib/routes";

/**
 * The web app manifest.
 *
 * Not an attempt to turn a shop into an app. It earns its place for three
 * smaller reasons: Android reads `theme_color` and the maskable icon from here
 * and nowhere else, an installed shortcut is a plausible thing for the owner to
 * want on his own phone, and Lighthouse marks the site down without one.
 *
 * The icons it names live in `public/` under stable filenames rather than
 * pointing at Next's `/icon` route, which is content-hashed and cannot be
 * written down. `pnpm brand:assets` generates both sets from `public/logo.png`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    /* Pins the app identity to the origin root. Without it the identity is
       derived from `start_url`, and changing that later would register as a
       different app on a phone that already had it installed. */
    id: "/",

    name: `${siteConfig.name} — ${siteConfig.tagline}`,
    /* Around twelve characters before Android truncates it under the icon. */
    short_name: siteConfig.shortName,
    description: siteConfig.description,

    lang: HTML_LANG[DEFAULT_LOCALE],
    dir: "ltr",
    /* The shop's home, not the bare `/`: that only redirects to it. `id` and
       `scope` stay at the root, so the installed app keeps its identity. */
    start_url: href(DEFAULT_LOCALE, routes.home),
    scope: "/",
    display: "standalone",

    /* The splash screen is the page background, not the header strip: an
       installed site that flashes dark and then turns paper reads as a fault.
       --color-paper, converted out of oklch. */
    background_color: "#faf6ee",
    /* --color-pine-900, the colour of the header's utility strip, which is what
       Android paints the status bar to match. */
    theme_color: "#002c1d",

    categories: ["shopping", "food"],

    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /**
       * A separate file rather than `purpose: "any maskable"` on the one above.
       * A launcher told an icon is both will crop the padded one when it shows
       * it unmasked, and the mark ends up swimming in white space.
       */
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],

    /* The two things someone who installed this would open it for. */
    shortcuts: [
      {
        name: "Категории",
        short_name: "Категории",
        url: href(DEFAULT_LOCALE, routes.categories),
      },
      {
        name: "Кое кафе е за мен",
        short_name: "Помощник",
        url: href(DEFAULT_LOCALE, routes.wizard),
      },
    ],
  };
}
