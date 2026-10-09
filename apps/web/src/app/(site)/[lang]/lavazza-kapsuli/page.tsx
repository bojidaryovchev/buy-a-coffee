import type { Metadata } from "next";
import { localeFrom, type LangParams } from "@/i18n/params";
import { LandingPage, landingMetadata } from "../_components/landing-page";

/**
 * Lavazza capsules, a section per system.
 *
 * „лаваца капсули“ is one search for three different products: capsules for
 * Lavazza Blue, for A Modo Mio, and Lavazza's own for Nespresso machines. They
 * do not fit each other's machines, so the page that answers the search is the
 * one that tells them apart. This is the only page whose title says „капсули
 * Lavazza“; the brand page and the two system pages link here instead.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return landingMetadata(await localeFrom(params), "lavazzaCapsules");
}

export default async function LavazzaCapsulesPage({ params }: PageProps) {
  return <LandingPage locale={await localeFrom(params)} id="lavazzaCapsules" />;
}
