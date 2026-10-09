import type { Metadata } from "next";
import { localeFrom, type LangParams } from "@/i18n/params";
import { LandingPage, landingMetadata } from "../_components/landing-page";

/**
 * Decaf, across every format, a section per system.
 *
 * Listed from the product's own flag (`attributes.decaf`), never from its
 * name. Each section carries its system's id as an anchor, so a system's shelf
 * can link straight to "decaf for this machine". This page owns „без кофеин“:
 * no system page carries the words in its title.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return landingMetadata(await localeFrom(params), "decaf");
}

export default async function DecafPage({ params }: PageProps) {
  return <LandingPage locale={await localeFrom(params)} id="decaf" />;
}
