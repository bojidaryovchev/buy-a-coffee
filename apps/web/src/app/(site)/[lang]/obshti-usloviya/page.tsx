import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-document";
import { termsOfService } from "@/content/legal";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { routes } from "@/lib/routes";

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  return {
    title: termsOfService.title,
    description: termsOfService.summary,
    alternates: pageAlternates(locale, routes.terms),
  };
}

export default async function Page({ params }: PageProps) {
  const locale = await localeFrom(params);
  return <LegalDocumentView locale={locale} path={routes.terms} document={termsOfService} />;
}
