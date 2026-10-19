import { landingImage, landingImageMetadata } from "@/lib/seo/og/landing";

/** This listing's share card; see `lib/seo/og/landing.tsx`. */
export const revalidate = 0;

type Params = Promise<{ lang: string }>;

export function generateImageMetadata({ params }: { params: Params }) {
  return landingImageMetadata(params, "cheapest");
}

export default function Image({ params }: { params: Params }) {
  return landingImage(params, "cheapest");
}
