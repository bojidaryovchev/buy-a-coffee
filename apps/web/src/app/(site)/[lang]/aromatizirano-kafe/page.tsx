import type { Metadata } from "next";
import { localeFrom, type LangParams } from "@/i18n/params";
import { LandingPage, landingMetadata } from "../_components/landing-page";

/**
 * Flavoured coffee, across every format, a section per system.
 *
 * Listed from the product's own flag (`attributes.aromas`), the one the
 * listings' "Ароматизирано" filter reads, never from its name. Grouped as the
 * decaf page is, because a flavoured capsule fits only its own system's
 * machine. This page owns „кафе лешник“, „кафе с вкус на лешник“, „кафе
 * карамел“ and „ароматизирано кафе“: no other page carries them in its title
 * or heading (`test/keyword-map.ts`).
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return landingMetadata(await localeFrom(params), "flavoured");
}

export default async function FlavouredPage({ params }: PageProps) {
  return <LandingPage locale={await localeFrom(params)} id="flavoured" />;
}
