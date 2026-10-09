import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { getCategoryTree } from "@/lib/catalog/queries";
import type { CategoryView } from "@/lib/catalog/types";
import { categoryHref, href } from "@/lib/routes";
import { businessSectionForCategory } from "../../(site)/[lang]/_lib/category-scope";

/**
 * `/categories/<slug>` — the shop's category URLs from before it had locales.
 *
 * Every other old URL is answered by the proxy from `lib/legacy-routes.ts`,
 * without a database. This one cannot be: the old URL carries our stored slug
 * (`kapsuli`, `nespresso`), the new one the category's landing slug
 * (`kafe-kapsuli`, `nespresso-kapsuli`), and only the catalog knows which
 * category a stored slug belongs to. Answered in one hop, so a link that has
 * earned its position passes it straight to the page that replaced it, with
 * its filters (`?brand=…&sort=…`) intact.
 *
 * Matched by stored slug first, then by source key, current or previous: old
 * links were written in our slugs, but a slug the source used is as good a name
 * as any for the category it named. A category that backs a business section
 * goes to the section's page, as its own URL always did. An old slug nothing
 * matches goes to the same slug under `/bg`, which is the 404 it already was.
 */
export const dynamic = "force-dynamic";

function flatten(nodes: readonly CategoryView[]): CategoryView[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function legacyCategory(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const locale = DEFAULT_LOCALE;
  const all = flatten(await getCategoryTree());
  const category =
    all.find((entry) => entry.slug === slug) ??
    all.find((entry) => entry.sourceKey === slug || entry.previousSourceKeys.includes(slug));

  const section = category ? businessSectionForCategory(category) : null;
  const target = section
    ? href(locale, section.path)
    : category
      ? categoryHref(locale, category)
      : href(locale, `/${slug}`);

  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.redirect(url, 308);
}

export const GET = legacyCategory;
export const HEAD = legacyCategory;
