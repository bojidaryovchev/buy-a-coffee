import type { Metadata } from "next";
import { localeFrom, type LangParams } from "@/i18n/params";
import { LandingPage, landingMetadata } from "../_components/landing-page";

/**
 * The lowest prices per cup, system by system.
 *
 * What "cheapest" means here is written down once, in `selectLanding`
 * (`lib/catalog/landings.ts`), and the page's own sentences state it from the
 * same constants — so the heading is true of what is under it.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return landingMetadata(await localeFrom(params), "cheapest");
}

export default async function CheapestPerCupPage({ params }: PageProps) {
  return <LandingPage locale={await localeFrom(params)} id="cheapest" />;
}
