import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-document";
import { termsOfService } from "@/content/legal";

export const metadata: Metadata = {
  title: termsOfService.title,
  description: termsOfService.summary,
  alternates: { canonical: "/terms" },
};

export default function Page() {
  return <LegalDocumentView document={termsOfService} />;
}
