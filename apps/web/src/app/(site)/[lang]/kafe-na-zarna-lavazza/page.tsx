import type { Metadata } from "next";
import { localeFrom, type LangParams } from "@/i18n/params";
import { LandingPage, landingMetadata } from "../_components/landing-page";

/**
 * Lavazza coffee beans: the brand's products on the bean shelf, and nothing
 * else. The brand page mixes five formats; someone who typed „кафе лаваца на
 * зърна“ asked for one.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return landingMetadata(await localeFrom(params), "lavazzaBeans");
}

export default async function LavazzaBeansPage({ params }: PageProps) {
  return <LandingPage locale={await localeFrom(params)} id="lavazzaBeans" />;
}
