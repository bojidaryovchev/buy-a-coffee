import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { productHref } from "@/lib/routes";
import { type CutoutRow, loadCutoutReview } from "@/lib/cutout-review";
import { approveCutout, rejectCutout } from "@/lib/cutout-review-actions";
import { formatAgo } from "@/lib/sync-display";

export const metadata: Metadata = { title: "Снимки" };
export const dynamic = "force-dynamic";

/**
 * Packshot cut-outs, for the owner to check (DESIGN.md, "Imagery").
 *
 * What needs an answer comes first: cut-outs a check had to repair or
 * question (the photo's own ground, the pack's shape, a reflection). Each is shown next to its photo, on the
 * cream of the page and on the green of the hero, where a bad edge shows at
 * once. Every action is a plain form, so the screen works without JavaScript.
 */

function percent(share: number): string {
  return `${(share * 100).toLocaleString("bg-BG", { maximumFractionDigits: 1 })} %`;
}

/** What the tool did to the mask, in words. */
function repairs(row: CutoutRow): string[] {
  const said: string[] = [];
  if (row.agreement !== null) said.push(`моделите са съгласни за ${percent(row.agreement)}`);
  if (row.shape && row.shape.holes > 0.001)
    said.push(`запълнени дупки ${percent(row.shape.holes)}`);
  for (const dent of row.shape?.dents ?? []) {
    said.push(`запълнен изрез ${percent(dent.share)}`);
  }
  if (row.shape?.box && row.shape.box > 0.9 && row.shape.dents.length > 0) {
    said.push("изправена до правоъгълник");
  }
  if (row.shape?.added && row.shape.added > 0.001)
    said.push(`допълнена от снимката ${percent(row.shape.added)}`);
  if (row.shape?.removed && row.shape.removed > 0.001)
    said.push(`махнато отражение ${percent(row.shape.removed)}`);
  if (row.shape?.reflection) said.push("може да е хванато отражението под опаковката");
  if (row.shape?.kept && row.shape.kept > 0.005)
    said.push(`светлосиво извън печата ${percent(row.shape.kept)}: сянка или бял ръб на кутията`);
  if (row.shape?.framed) said.push("стига до края на снимката: може да е хванат фонът");
  return said;
}

function Products({ row }: { row: CutoutRow }) {
  if (row.products.length === 0) return <span className="text-ink-500">без активен продукт</span>;
  return (
    <>
      {row.products.map((product, index) => (
        <span key={product.slug}>
          {index > 0 && ", "}
          <Link
            href={productHref(DEFAULT_LOCALE, product)}
            className="font-semibold text-ink-900 hover:underline"
          >
            {product.name}
          </Link>
        </span>
      ))}
    </>
  );
}

/** One picture in a 160 px box, on the given ground. */
function Shot({
  src,
  ground,
  label,
}: {
  src: string;
  ground: "white" | "cream" | "pine";
  label: string;
}) {
  const surface = { white: "bg-well", cream: "bg-paper", pine: "bg-pine-900" }[ground];
  return (
    <figure className="flex flex-col gap-1">
      {/* A fixed box and a picture filling it, contained: a percentage
          max-height inside an auto-sized grid cell resolves to nothing, and a
          cut-out 900 px tall then ran out of its box. Drawn through the image
          optimizer at the box's size, not as the stored PNG of 300 KB or more. */}
      <div className={`size-40 rounded-sm border border-line p-3 ${surface}`}>
        <div className="relative size-full">
          <Image src={src} alt={label} fill sizes="136px" className="object-contain" />
        </div>
      </div>
      <figcaption className="text-xs text-ink-500">{label}</figcaption>
    </figure>
  );
}

function Decision({ row, approve, reject }: { row: CutoutRow; approve?: string; reject?: string }) {
  if (!row.objectKey) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {approve && (
        <form action={approveCutout}>
          <input type="hidden" name="hash" value={row.hash} />
          <input type="hidden" name="key" value={row.objectKey} />
          <Button type="submit" size="sm">
            {approve}
          </Button>
        </form>
      )}
      {reject && (
        <form action={rejectCutout}>
          <input type="hidden" name="hash" value={row.hash} />
          <input type="hidden" name="key" value={row.objectKey} />
          <Button type="submit" size="sm" variant="secondary">
            {reject}
          </Button>
        </form>
      )}
    </div>
  );
}

function PendingCard({ row, now }: { row: CutoutRow; now: Date }) {
  return (
    <li className="rounded-md border border-caution bg-paper-raised p-4">
      <p className="text-sm">
        <Products row={row} />
        <span className="text-ink-500"> · {formatAgo(row.updatedAt, now)}</span>
      </p>
      <p className="mt-1 text-sm text-ink-700">{repairs(row).join("; ")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        {row.originalUrl && <Shot src={row.originalUrl} ground="white" label="Снимката" />}
        {row.cutoutUrl && <Shot src={row.cutoutUrl} ground="cream" label="Изрязана, на кремаво" />}
        {row.cutoutUrl && <Shot src={row.cutoutUrl} ground="pine" label="Изрязана, на зелено" />}
      </div>
      <div className="mt-3">
        <Decision row={row} approve="Покажи изрязаната" reject="Остави снимката на бял фон" />
      </div>
    </li>
  );
}

function Tile({ row, children }: { row: CutoutRow; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-paper-raised p-3">
      {row.cutoutUrl && (
        <div className="h-32 rounded-sm bg-paper p-2">
          <div className="relative size-full">
            <Image
              src={row.cutoutUrl}
              alt=""
              fill
              sizes="(min-width: 1024px) 180px, (min-width: 640px) 25vw, 50vw"
              className="object-contain"
            />
          </div>
        </div>
      )}
      <p className="text-xs">
        <Products row={row} />
      </p>
      {children}
    </li>
  );
}

export default async function AdminCutoutsPage() {
  const now = new Date();
  const { counts, pending, failed, live, rejected } = await loadCutoutReview();

  return (
    <>
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink-900">Снимки</h1>
        <p className="mt-1 max-w-3xl text-base text-ink-500">
          Опаковките, изрязани от фона на снимката им след всяка синхронизация. Когато проверките не
          намерят нищо, изрязаната снимка се показва сама; останалите чакат тук. Отхвърлената остава
          на бял фон и не се изрязва отново. Решението се вижда в магазина до пет минути.
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Показват се", counts.auto + counts.approved],
          ["Чакат решение", counts.pending],
          ["На бял фон", counts.rejected],
          ["Неуспешни", counts.failed],
          ["Още неизрязани", counts.uncut],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-line bg-paper-raised p-3">
            <dt className="text-xs text-ink-500">{label}</dt>
            <dd className="text-2xl font-semibold text-ink-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="pending" className="mt-10">
        <h2 id="pending" className="text-lg font-semibold text-ink-900">
          Чакат решение
        </h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Нищо не чака.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {pending.map((row) => (
              <PendingCard key={row.hash} row={row} now={now} />
            ))}
          </ul>
        )}
      </section>

      {failed.length > 0 && (
        <section aria-labelledby="failed" className="mt-10">
          <h2 id="failed" className="text-lg font-semibold text-ink-900">
            Неуспешни
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Опитват се отново при следващото изрязване, до три пъти. Дотогава продуктът е на бял
            фон.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {failed.map((row) => (
              <li
                key={row.hash}
                className="rounded-md border border-line bg-paper-raised p-3 text-sm"
              >
                <Products row={row} />
                <span className="text-ink-500">
                  {" "}
                  · опит {row.attempts} · {row.lastError}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="live" className="mt-10">
        <h2 id="live" className="text-lg font-semibold text-ink-900">
          Показват се
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Всички {live.length}, най-новите отпред. Свалената се връща на бял фон.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {live.map((row) => (
            <Tile key={row.hash} row={row}>
              <Decision row={row} reject="Свали" />
            </Tile>
          ))}
        </ul>
      </section>

      {rejected.length > 0 && (
        <section aria-labelledby="rejected" className="mt-10">
          <h2 id="rejected" className="text-lg font-semibold text-ink-900">
            На бял фон по ваше решение
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {rejected.map((row) => (
              <Tile key={row.hash} row={row}>
                <Decision row={row} approve="Покажи все пак" />
              </Tile>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
