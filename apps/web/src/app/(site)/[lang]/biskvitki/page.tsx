import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-document";
import { cookiePolicy } from "@/content/legal";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { routes } from "@/lib/routes";

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  return {
    title: cookiePolicy.title,
    description: cookiePolicy.summary,
    alternates: pageAlternates(locale, routes.cookies),
  };
}

export default async function Page({ params }: PageProps) {
  const locale = await localeFrom(params);
  return <LegalDocumentView locale={locale} path={routes.cookies} document={cookiePolicy} />;
}
