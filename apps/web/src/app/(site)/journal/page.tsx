import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs, ButtonLink, EmptyState } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";

/**
 * Journal.
 *
 * The reference site publishes a blog route that currently has no articles.
 * The capability is reproduced — the route exists, is linked and is styled —
 * but no content is invented to fill it, and none is copied from the source.
 *
 * When the shop wants to write, the content source goes here (MDX files or a
 * small table). Until then this is an honest empty state rather than filler.
 */
export const metadata: Metadata = {
  title: "Дневник",
  description: `Бележки за кафето от ${siteConfig.name}.`,
  alternates: { canonical: "/journal" },
};

export default function JournalPage() {
  if (!siteConfig.features.blog) notFound();

  return (
    <div className="shell pb-16">
      <Breadcrumbs
        items={[
          { name: "Начало", href: "/" },
          { name: "Дневник", href: "/journal" },
        ]}
      />

      <header className="mb-8 max-w-prose">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">Дневник</h1>
        <p className="mt-2 text-base text-ink-500">Кратки бележки за това какво пием и защо.</p>
      </header>

      <EmptyState
        title="Още нищо публикувано"
        description="Пишем първите текстове. Междувременно асортиментът е по-интересното четиво."
        action={
          <ButtonLink href="/categories" variant="secondary">
            Разгледай асортимента
          </ButtonLink>
        }
      />
    </div>
  );
}
