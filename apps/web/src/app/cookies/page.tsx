import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal-document";
import { cookiePolicy } from "@/content/legal";

export const metadata: Metadata = {
  title: cookiePolicy.title,
  description: cookiePolicy.summary,
  alternates: { canonical: "/cookies" },
};

export default function Page() {
  return <LegalDocumentView document={cookiePolicy} />;
}
