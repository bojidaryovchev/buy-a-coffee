import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-document";
import { cookiePolicy } from "@/content/legal";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { href, routes } from "@/lib/routes";
import { pageTitle } from "@/lib/seo/title";
import { cookiesMeta } from "@/lib/seo/page-meta";

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const { title, description } = cookiesMeta();
  return {
    title: pageTitle(title),
    description,
    alternates: pageAlternates(locale, routes.cookies),
    ...shareMetadata({ locale, title, description, path: href(locale, routes.cookies) }),
  };
}

export default async function Page({ params }: PageProps) {
  const locale = await localeFrom(params);
  return <LegalDocumentView locale={locale} path={routes.cookies} document={cookiePolicy} />;
}
