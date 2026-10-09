import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-document";
import { privacyPolicy } from "@/content/legal";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { href, routes } from "@/lib/routes";

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  return {
    title: privacyPolicy.title,
    description: privacyPolicy.summary,
    alternates: pageAlternates(locale, routes.privacy),
    ...shareMetadata({
      locale,
      title: privacyPolicy.title,
      description: privacyPolicy.summary,
      path: href(locale, routes.privacy),
    }),
  };
}

export default async function Page({ params }: PageProps) {
  const locale = await localeFrom(params);
  return <LegalDocumentView locale={locale} path={routes.privacy} document={privacyPolicy} />;
}
