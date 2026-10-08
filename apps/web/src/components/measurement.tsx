"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";
import { dropAdmin, isAdminUrl } from "@/lib/analytics";

/**
 * The platform's cookieless Web Analytics and Speed Insights, mounted once from
 * the root layout.
 *
 * Nothing under `/admin` is measured, and that is enforced twice. Here, by not
 * rendering the scripts on an admin path at all — so a direct visit to the panel
 * loads no measurement code. And in `beforeSend`, which drops any event whose
 * URL is in the panel, covering client-side navigation from the shop into the
 * panel, where the scripts were already running. The panel lists customers'
 * phone numbers; no admin URL may leave the server.
 *
 * Both scripts are served from this site's own origin in production
 * (`/_vercel/insights/*`, `/_vercel/speed-insights/*`) and set no cookie.
 */
export function Measurement() {
  const pathname = usePathname();
  if (isAdminUrl(pathname)) return null;

  return (
    <>
      <Analytics beforeSend={dropAdmin} />
      <SpeedInsights beforeSend={dropAdmin} />
    </>
  );
}
