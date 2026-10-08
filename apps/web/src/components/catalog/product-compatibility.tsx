import Link from "next/link";
import { joinList } from "@/components/commerce/terms";
import { compatibleMachines } from "@/lib/catalog/product-facts";
import type { BrewingSystem } from "@/lib/recommend/systems";

/**
 * "Става за тези машини" on a capsule or pod product page.
 *
 * Specified in DESIGN.md, "Product page" → "Compatibility". A compatibility
 * claim is a promise that a box will go in a machine, so nothing here is
 * composed: the sentence is the system's own `recognise` text, and every
 * machine named is an entry in the hand-written machine database that points
 * at this system. A system with no machine on record gets no section.
 *
 * There is no page per machine model, so each model links to its maker's page
 * in the machine finder, where it is listed under the system it takes.
 *
 * Renders nothing for beans: "an automatic machine with a grinder" is not a
 * list of models anybody needs to check a bag of coffee against.
 */
export function ProductCompatibility({ system }: { system: BrewingSystem }) {
  if (system.method === "beans") return null;

  const machines = compatibleMachines(system.id);
  if (machines.shown.length === 0) return null;

  return (
    <section className="mt-12 md:mt-16">
      <h2 className="mb-6 font-display text-2xl font-semibold text-ink-900 md:text-3xl">
        Става за тези машини
      </h2>
      <p className="max-w-(--container-measure) text-base text-ink-700">{system.recognise}</p>

      <ul className="mt-4 flex flex-wrap gap-2">
        {machines.shown.map((machine) => (
          <li key={machine.name}>
            <Link
              href={machine.href}
              className="inline-flex min-h-9 items-center rounded-sm border border-line bg-paper-raised px-3 py-1 text-sm font-medium text-ink-900 transition-colors hover:border-pine-500"
            >
              {machine.name}
            </Link>
          </li>
        ))}
      </ul>

      {/*
        Said in words, not by a mark on the chip: these makers did not design
        their machines for this capsule, and the customer should know that the
        fit is one of format before they rely on it.
      */}
      {machines.crossFormatBrands.length > 0 && (
        <p className="mt-4 max-w-(--container-measure) text-sm text-ink-700">
          Машините {joinList(machines.crossFormatBrands)} приемат същия формат капсула. Капсулите не
          са произведени от производителя на машината, а са съвместими по размер и форма.
        </p>
      )}

      <p className="mt-4 text-sm text-ink-700">
        {machines.total > machines.shown.length && (
          <>
            Показани са {machines.shown.length} от {machines.total} модела.{" "}
          </>
        )}
        <Link
          href="/wizard/machines"
          className="inline-flex min-h-6 items-center text-pine-700 underline underline-offset-2 hover:no-underline"
        >
          Вижте всички машини
        </Link>
      </p>
    </section>
  );
}
