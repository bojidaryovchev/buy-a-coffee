import { Inter, Literata } from "next/font/google";

/**
 * The two faces, defined once for the three documents that draw a page: the
 * shop's root layout (`(site)/[lang]/layout.tsx`), the panel's
 * (`(admin)/layout.tsx`) and the 404 for a URL that matched no route
 * (`global-not-found.tsx`).
 *
 * There is no `app/layout.tsx` any more. `<html lang>` has to follow the
 * locale, a root layout cannot read a dynamic segment below itself, so the
 * shop's root moved under `[lang]` — and with it every document became its own
 * root. `next/font` must be called at module scope, which is why the faces live
 * in this module rather than in any one of them.
 *
 * Both faces carry the Cyrillic subset. That is not optional: the catalog is
 * Bulgarian, and a Latin-only face would draw every product name in a fallback.
 */
const inter = Inter({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

const literata = Literata({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-literata",
  weight: ["400", "600", "700"],
  display: "swap",
});

export const fontVariables = `${inter.variable} ${literata.variable}`;

/** The `<body>` every document shares. */
export const BODY_CLASS = "flex min-h-dvh flex-col bg-paper text-ink-900 antialiased";
