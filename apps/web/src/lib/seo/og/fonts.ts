import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The faces the share cards are drawn in: the site's own, Literata for the
 * heading and Inter for everything a customer reads to decide (DESIGN.md,
 * "Typography").
 *
 * **Why they are files here and not `next/font`.** `ImageResponse` draws with
 * satori, which reads font files itself and has no access to the faces
 * `next/font` resolves into `.next` at build. Satori's fallback face carries
 * no Cyrillic, which is why the first share card had no text at all: a
 * Bulgarian line would have come out as a row of empty boxes. These are the
 * same families, from Google Fonts, cut down with fontTools to Latin, Latin-1,
 * Latin Extended-A, Cyrillic and the punctuation and signs the shop prints
 * („“ — … € № ≈ −), about 70 KB each. TTF, the format satori parses fastest.
 * Licensed under the SIL Open Font License 1.1, which `assets/og/OFL-*.txt`
 * carry beside them, as the licence asks.
 *
 * Read from `assets/og/` under the app's directory. `next.config.ts` names
 * them in `outputFileTracingIncludes` for the routes that draw cards, so a
 * card rendered on request finds them on the deployed function too.
 */

export interface OgFont {
  readonly name: "Inter" | "Literata";
  readonly data: Buffer;
  readonly weight: 400 | 600;
  readonly style: "normal";
}

const FILES = [
  { name: "Inter", weight: 400, file: "Inter-Regular.ttf" },
  { name: "Inter", weight: 600, file: "Inter-SemiBold.ttf" },
  { name: "Literata", weight: 600, file: "Literata-SemiBold.ttf" },
] as const;

let loaded: Promise<OgFont[]> | null = null;

/** The faces, read once per server instance. */
export function ogFonts(): Promise<OgFont[]> {
  loaded ??= Promise.all(
    FILES.map(async ({ name, weight, file }) => ({
      name,
      weight,
      style: "normal" as const,
      data: await readFile(path.join(process.cwd(), "assets", "og", file)),
    })),
  ).catch((error: unknown) => {
    // Not cached: a failed read is retried on the next card.
    loaded = null;
    throw error;
  });
  return loaded;
}
