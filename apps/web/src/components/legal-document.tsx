import { Breadcrumbs } from "@/components/ui/primitives";
import type { LegalDocument } from "@/content/legal";

/**
 * Renders a legal document.
 *
 * A "REVIEW REQUIRED" paragraph is displayed as a visible callout rather than
 * being hidden or quietly dropped. A placeholder that looks like finished
 * legal text is worse than an obvious gap: the gap gets fixed, the plausible
 * placeholder ships.
 */
export function LegalDocumentView({ document }: { document: LegalDocument }) {
  return (
    <div className="shell pb-16">
      <Breadcrumbs items={[{ name: "Начало", href: "/" }, { name: document.title, href: `/${document.slug}` }]} />

      <article className="max-w-(--container-measure)">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">{document.title}</h1>
        <p className="mt-2 text-base text-ink-500">{document.summary}</p>

        {document.needsReview && (
          <aside
            role="note"
            className="mt-6 rounded-md border border-clay-500/50 bg-clay-100 p-4 text-sm text-ink-900"
          >
            <p className="font-semibold">Този документ е чернова.</p>
            <p className="mt-1 text-ink-700">
              Той описва точно как работи този сайт, но текстът, специфичен за българското
              законодателство, не е преглеждан от юрист. Разделите, отбелязани с
              <strong> ЗА ПРЕГЛЕД</strong>, трябва да бъдат довършени преди пускането на сайта.
            </p>
          </aside>
        )}

        <div className="mt-8 space-y-8">
          {document.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-xl font-semibold text-ink-900">{section.heading}</h2>
              {section.paragraphs.map((paragraph) =>
                paragraph.startsWith("ЗА ПРЕГЛЕД") ? (
                  <p
                    key={paragraph}
                    className="mt-3 rounded-sm border-l-2 border-clay-500 bg-clay-100/60 px-3 py-2 text-sm text-ink-700"
                  >
                    {paragraph}
                  </p>
                ) : (
                  <p key={paragraph} className="mt-3 text-base leading-relaxed text-ink-700">
                    {paragraph}
                  </p>
                ),
              )}
              {section.bullets && (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-base text-ink-700">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
