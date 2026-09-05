import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/admin-queries";
import { updateOrderStatus } from "@/lib/admin-actions";
import type { InquiryStatus } from "@/lib/inquiry-status";
import { MAIL_ADDRESS } from "@/lib/mail/identity";
import { recordReference } from "@/lib/mail/reply";
import { StatusPicker } from "@/components/admin/status-picker";
import { RecordReplyForm } from "@/components/admin/record-reply-form";

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
 */
export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  return (
    <>
      <Link href="/admin/zayavki" className="text-sm text-ink-500 hover:text-ink-900">
        ← Всички заявки
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">
            {order.customerName || "Заявка без име"}
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

      <dl className="mt-8 grid gap-x-8 gap-y-4 rounded-md border border-line bg-paper-raised p-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium tracking-wide text-ink-500 uppercase">Продукт</dt>
          <dd className="mt-1 text-ink-900">
            {order.productSlug ? (
              <Link href={`/products/${order.productSlug}`} className="underline">
                {order.productName ?? order.productSlug}
              </Link>
            ) : (
              (order.productName ?? "(изтрит продукт)")
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-ink-500 uppercase">Количество</dt>
          <dd className="mt-1 text-ink-900 tabular-nums">{order.quantity}</dd>
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
