import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { productHref } from "@/lib/routes";
import { notFound } from "next/navigation";
import { getOrder, getSubscriberByEmail } from "@/lib/admin-queries";
import { updateOrderStatus } from "@/lib/admin-actions";
import type { InquiryStatus } from "@/lib/inquiry-status";
import { MAIL_ADDRESS } from "@/lib/mail/identity";
import { recordReference } from "@/lib/mail/reply";
import { StatusPicker } from "@/components/admin/status-picker";
import { RecordReplyForm } from "@/components/admin/record-reply-form";
import { NewsletterMarkForm } from "@/components/admin/newsletter-mark-form";
import { deliveryLines, fullName } from "@/lib/orders/delivery";
import { lineTotal, orderSum, productCount, storedLine } from "@/lib/orders/lines";
import { toPriceView } from "@/lib/catalog/format";

export const metadata: Metadata = { title: "Заявка" };
export const dynamic = "force-dynamic";

/**
 * One order enquiry.
 *
 * The phone number is a `tel:` link and set large, because on this screen it is
 * the primary action and the device it is read on is usually the device that
 * can dial it.
 *
 * The email reply box appears only when there is an address to reply to. The
 * order form requires a phone and treats the email as optional, so "no email" is
 * an ordinary state and not an error — showing a disabled form for it would
 * imply something is missing that never was.
 *
 * What was ordered is a table: one row per product, under the supplier's name
 * (what the owner orders by), with the quantity and the price it was priced at
 * when the request came in — not today's. A request from before the cart has
 * no recorded price, and the table says so rather than looking one up.
 */
export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();
  const subscriber = order.email ? await getSubscriberByEmail(order.email) : null;
  const sum = orderSum(order.items.map((item) => storedLine(item, "")));
  // A line from before the cart recorded no price and no shop name.
  const unrecorded = order.items.some((item) => item.displayName === null);
  const delivery = deliveryLines(order);

  return (
    <>
      <Link href="/admin/zayavki" className="text-sm text-ink-500 hover:text-ink-900">
        ← Всички заявки
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">
            {fullName(order) || "Заявка без име"}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {/* The reference the customer would see in a reply's subject line,
                shown here so the two can be matched by eye. */}
            Референция {recordReference(order.id)} ·{" "}
            {order.createdAt.toISOString().slice(0, 16).replace("T", " ")}
          </p>
        </div>
        <a
          href={`tel:${order.phone.replace(/\s+/g, "")}`}
          className="font-display text-2xl font-semibold text-pine-700 underline-offset-4 hover:underline"
        >
          {order.phone}
        </a>
      </div>

      <section className="mt-8 overflow-x-auto rounded-md border border-line bg-paper-raised">
        <h2 className="px-5 pt-4 text-xs font-medium tracking-wide text-ink-500 uppercase">
          Поръчано · {productCount(order.items.length)}, {sum.units} бр.
        </h2>
        <table className="mt-2 w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              <th scope="col" className="px-5 py-2 font-medium">
                Продукт
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Брой
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Цена за брой
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                Сума
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line">
            {order.items.map((item, index) => {
              const unit = item.unitPrice ? toPriceView(item.unitPrice, item.currency) : null;
              const total = lineTotal(storedLine(item, "").unitPrice, item.quantity);
              const name = item.productName ?? "(изтрит продукт)";
              return (
                <tr key={index} className="align-top text-ink-900">
                  <td className="px-5 py-3">
                    {item.productSlug ? (
                      <Link
                        href={productHref(DEFAULT_LOCALE, { slug: item.productSlug })}
                        className="underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.quantity}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {unit ? (
                      unit.formatted
                    ) : (
                      <span className="text-ink-500">
                        {item.displayName === null ? "не е записана" : "при запитване"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">
                    {total?.formatted ?? <span className="font-normal text-ink-500">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-line-strong">
            <tr className="text-ink-900">
              <th scope="row" colSpan={3} className="px-5 py-3 text-left font-semibold">
                Сума на продуктите
                {sum.unpriced > 0 && sum.subtotal && (
                  <span className="ml-2 font-normal text-ink-500">
                    без {productCount(sum.unpriced)} без цена
                  </span>
                )}
              </th>
              <td className="px-5 py-3 text-right font-semibold tabular-nums">
                {sum.subtotal?.formatted ?? <span className="font-normal text-ink-500">—</span>}
              </td>
            </tr>
          </tfoot>
        </table>
        {unrecorded && (
          <p className="px-5 pb-4 text-xs text-ink-500">
            Заявка отпреди количката: цената, на която е поръчано, не е записана.
          </p>
        )}
      </section>

      <dl className="mt-6 grid gap-x-8 gap-y-4 rounded-md border border-line bg-paper-raised p-5 sm:grid-cols-2">
        {/* What the courier's form asks for, in the order it asks: how, where,
            and who. One click selects the block for copying. */}
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium tracking-wide text-ink-500 uppercase">Доставка</dt>
          <dd className="mt-1 text-ink-900">
            {delivery ? (
              <p className="leading-relaxed select-all">
                {delivery.map((line, index) => (
                  <span key={index} className={index === 0 ? "font-semibold" : undefined}>
                    {index > 0 && <br />}
                    {line}
                  </span>
                ))}
                <br />
                {fullName(order)}, {order.phone}
              </p>
            ) : (
              <span className="text-ink-500">
                не е посочена: заявката е отпреди формата да пита за доставка
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-ink-500 uppercase">Имейл</dt>
          <dd className="mt-1 text-ink-900">
            {order.email ? (
              <a href={`mailto:${order.email}`} className="underline">
                {order.email}
              </a>
            ) : (
              <span className="text-ink-500">не е посочен</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-ink-500 uppercase">Дошла от</dt>
          <dd className="mt-1 text-ink-900">{order.sourcePage ?? "—"}</dd>
        </div>
        {order.notes && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium tracking-wide text-ink-500 uppercase">Бележка</dt>
            <dd className="mt-1 leading-relaxed whitespace-pre-wrap text-ink-700">{order.notes}</dd>
          </div>
        )}
      </dl>

      <div className="mt-6">
        <p className="text-sm font-semibold text-ink-900">Състояние</p>
        <div className="mt-2">
          <StatusPicker
            id={order.id}
            current={order.status as InquiryStatus}
            action={updateOrderStatus}
          />
        </div>
      </div>

      {order.email && (
        <NewsletterMarkForm
          recordId={order.id}
          kind="order"
          email={order.email}
          current={subscriber}
        />
      )}

      {order.email ? (
        <RecordReplyForm
          recordId={order.id}
          kind="order"
          recipient={order.email}
          sender={MAIL_ADDRESS}
        />
      ) : (
        <p className="mt-6 rounded-md border border-dashed border-line-strong bg-paper-raised p-5 text-sm text-ink-500">
          Няма имейл адрес — тази заявка може да бъде продължена само по телефона.
        </p>
      )}
    </>
  );
}
