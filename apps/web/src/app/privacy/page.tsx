import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-document";
import { privacyPolicy } from "@/content/legal";

export const metadata: Metadata = {
  title: privacyPolicy.title,
  description: privacyPolicy.summary,
  alternates: { canonical: "/privacy" },
};

export default function Page() {
  return <LegalDocumentView document={privacyPolicy} />;
}
