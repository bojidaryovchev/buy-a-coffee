import { buttonClasses } from "@/components/ui/primitives";
import { createNewsletterFromTemplate } from "@/lib/newsletter/template-actions";
import { deletePromotion, duplicatePromotion, stopPromotion } from "@/lib/promotions/actions";
import type { PromotionStatus } from "@/lib/promotions/status";

/**
 * What can be done to a promotion besides editing it, each a plain form, so
 * the screen works without JavaScript like the rest of the panel:
 *
 *   - "Обяви в бюлетина" — a newsletter draft announcing it, which the owner
 *     then reads and sends (`createNewsletterFromTemplate`). While it is
 *     running or upcoming.
 *   - "Дублирай" — the same choice as a new promotion starting tomorrow.
 *     Always; for one that is over, the only thing there is to do.
 *   - "Спри сега" — while it runs, behind a second step that says what it
 *     does: prices go back at once, and it cannot be undone.
 *   - "Изтрий" — only before it starts, behind a second step. A promotion
 *     that has started is never deleted.
 *
 * The confirmations are `<details>`, like the newsletter's send.
 */

const CONFIRM_SUMMARY = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";

export function PromotionActions({
  promotionId,
  name,
  status,
}: {
  promotionId: string;
  name: string;
  status: PromotionStatus;
}) {
  const live = status === "running" || status === "upcoming";
  return (
    <section aria-labelledby="actions-title" className="mt-4">
      <h2 id="actions-title" className="sr-only">
        Действия
      </h2>
      <div className="flex flex-wrap items-start gap-3">
        {live && (
          <form action={createNewsletterFromTemplate}>
            <input type="hidden" name="template" value="promotion" />
            <input type="hidden" name="promotionId" value={promotionId} />
            <button type="submit" className={buttonClasses({ variant: "secondary" })}>
              Обяви в бюлетина
            </button>
          </form>
        )}

        <form action={duplicatePromotion}>
          <input type="hidden" name="id" value={promotionId} />
          <button type="submit" className={buttonClasses({ variant: "secondary" })}>
            Дублирай
          </button>
        </form>

        {status === "running" && (
          <details className="group">
            <summary className={`${buttonClasses({ variant: "secondary" })} ${CONFIRM_SUMMARY}`}>
              Спри сега
            </summary>
            <div className="mt-3 max-w-md rounded-md bg-caution-100 p-4 text-sm text-ink-900">
              <p className="font-semibold text-caution">Спиране на „{name}“</p>
              <p className="mt-1">
                Цените в магазина се връщат към обикновените веднага. Спряна промоция не може да
                бъде пусната отново; можете да започнете нова с „Дублирай“.
              </p>
              <form action={stopPromotion} className="mt-3">
                <input type="hidden" name="id" value={promotionId} />
                <button type="submit" className={buttonClasses({ variant: "danger" })}>
                  Да, спри я сега
                </button>
              </form>
            </div>
          </details>
        )}

        {status === "upcoming" && (
          <details className="group">
            <summary className={`${buttonClasses({ variant: "secondary" })} ${CONFIRM_SUMMARY}`}>
              Изтрий
            </summary>
            <div className="mt-3 max-w-md rounded-md bg-caution-100 p-4 text-sm text-ink-900">
              <p className="font-semibold text-caution">Изтриване на „{name}“</p>
              <p className="mt-1">
                Промоцията още не е започнала и изчезва напълно. Това не може да се отмени.
              </p>
              <form action={deletePromotion} className="mt-3">
                <input type="hidden" name="id" value={promotionId} />
                <button type="submit" className={buttonClasses({ variant: "danger" })}>
                  Да, изтрий я
                </button>
              </form>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
