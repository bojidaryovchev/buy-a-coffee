import { siteConfig, absoluteUrl, usingPlaceholderBrand } from "@/config/site";
import { getCatalogSummary, getCategoryTree, listBrands } from "@/lib/catalog/queries";
import { MACHINE_BRANDS } from "@/content/machines";

/**
 * `/llms.txt` — a plain-language map of the shop for AI search.
 *
 * Generated from the live catalog rather than written, so it cannot drift the
 * way a hand-maintained file would. The three vend repos have carried one for
 * months; this repo did not, which is the whole reason it is here.
 *
 * WHY IT IS WORTH HAVING on a shop rather than a catalogue of specifications:
 * the two pages this site has that nothing else in the market does are the
 * wizard and the machine-compatibility pages. "Which capsules fit a Krups
 * Piccolo" is a question a person asks an assistant, not a search box, and the
 * answer is a page we already publish. `robots.ts` deliberately does not block
 * any AI crawler, so being quotable is the point.
 *
 * ⚠ IT MUST NEVER OUTLIVE THE INDEXING GATE. `robots.ts` closes the site to
 * crawlers on anything that is not production, and this file has to agree with
 * it: a machine-readable summary of a shop whose prices are still being
 * confirmed is the same mistake as an indexed catalogue, in the one format
 * designed to be quoted verbatim.
 *
 * The company's legal identity is deliberately absent while
 * `usingPlaceholderBrand()` is true. `organizationJsonLd` guards it the same
 * way, for the same reason: a fabricated company number must not reach a format
 * built to be repeated.
 */

export const revalidate = 3600;

const isProduction = (): boolean => {
  const hostEnvironment = process.env.VERCEL_ENV;
  if (hostEnvironment) return hostEnvironment === "production";
  return (
    process.env.NEXT_PUBLIC_ENVIRONMENT === "production" ||
    (process.env.NODE_ENV === "production" &&
      process.env.NEXT_PUBLIC_ENVIRONMENT === undefined)
  );
};

export async function GET() {
  if (!isProduction()) {
    return new Response("# Not available on this deployment.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const [summary, tree, brands] = await Promise.all([
    getCatalogSummary(),
    getCategoryTree(),
    listBrands({ withProductsOnly: true }),
  ]);

  /* Top-level categories only. The tree runs three deep in places, and a flat
     list of every leaf would be a sitemap in prose rather than a map. */
  const categories = tree
    .map((c) => `- [${c.name}](${absoluteUrl(`/categories/${c.slug}`)})`)
    .join("\n");

  const brandList = brands
    .map((b) => `- [${b.name}](${absoluteUrl(`/brands/${b.slug}`)})`)
    .join("\n");

  const key = (
    [
      ["/wizard", "Кое кафе е за мен — препоръка по система, вкус и бюджет"],
      ["/wizard/machines", "Коя капсула става за моята машина — по марка и модел"],
      ["/categories", "Всички категории"],
      ["/brands", "Всички марки"],
      ["/promotions", "Промоции"],
      ["/contact", "Контакти"],
    ] as const
  )
    .map(([path, label]) => `- [${label}](${absoluteUrl(path)})`)
    .join("\n");

  const body = `# ${siteConfig.name}

> ${siteConfig.description}

Онлайн магазин за кафе в България: ${summary.products} продукта от
${summary.brands} марки в ${summary.categories} категории. Поръчката е на една
стъпка — оставяте телефон и ние се обаждаме за потвърждение.

Ключови факти:

- Обхват: само България. Всички цени са в ${siteConfig.currency}.
- Продават се кафе на зърна, капсули и дози (доза-в-опаковка), както и
  консумативи.
- Поръчката не изисква регистрация и не се плаща онлайн — потвърждава се по
  телефон.
- Работно време за запитвания: ${siteConfig.contact.hours}
- Телефон: ${siteConfig.contact.phone}
- Имейл: ${siteConfig.contact.email}

## Категории

${categories}

## Марки

${brandList}

## Основни страници

${key}

## Съвместимост с машини

Сайтът публикува страница за всяка от ${MACHINE_BRANDS.length} марки машини,
която казва коя капсулна система използва тя и кои капсули от каталога стават за
нея. Това е основната разлика от останалите магазини в бранша, където
съвместимостта се търси в описанието на продукта.

## Бележки

- Наличността и цените се синхронизират автоматично и се публикуват такива,
  каквито са в момента на заявката. Няма отделен списък с бройки.
- Продукт, който вече не се предлага, запазва адреса си и показва изрично, че е
  изчерпан, вместо да връща 404.
- Сайтът не публикува ревюта и няма рейтинги. Структурираните данни също не
  съдържат такива — няма измислени оценки.
${
  usingPlaceholderBrand()
    ? "- Фирмените регистрационни данни още не са публикувани и умишлено не се\n  посочват тук."
    : `- Фирма: ${siteConfig.legal.companyName}, ЕИК ${siteConfig.legal.companyId}.`
}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
