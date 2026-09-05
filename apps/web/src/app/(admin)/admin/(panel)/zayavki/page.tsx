import type { Metadata } from "next";
import Link from "next/link";
import { listOrders } from "@/lib/admin-queries";
import { INQUIRY_STATUS_LABEL, type InquiryStatus } from "@/lib/inquiry-status";

export const metadata: Metadata = { title: "Заявки" };
export const dynamic = "force-dynamic";

/**
 * Order enquiries.
 *
 * The shop has no cart and no checkout: a product page takes a phone number and
 * somebody rings back. This table has been filling up since the site launched
 * and, until now, nothing in the application could read it — which meant the
 * one screen the business actually needed did not exist.
 *
 * The phone number is on the list rather than one click in. It is the action:
 * the operator's next move on almost every row here is to dial it, and hiding
 * the only useful field behind a navigation is the classic way to make a
 * working panel feel slow.
 */

const STATUS_TONE: Record<InquiryStatus, string> = {
  new: "bg-clay-100 text-clay-600",
  contacted: "bg-pine-100 text-pine-700",
  converted: "bg-pine-100 text-pine-700",
  cancelled: "bg-paper-sunken text-ink-500",
  spam: "bg-paper-sunken text-ink-500",
};

export default async function AdminOrdersPage() {
  const orders = await listOrders();
  const fresh = orders.filter((o) => o.status === "new").length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Заявки</h1>
          <p className="mt-1 text-base text-ink-500">
            Заявки за поръчка от продуктовите страници. Обаждаме се ние.
          </p>
        </div>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{fresh}</span>{" "}
          <span className="text-ink-500">нови</span>
        </p>
      </div>

      {orders.length === 0 ? (
        <p className="mt-10 rounded-md border border-dashed border-line-strong bg-paper-raised p-10 text-center text-ink-500">
          Още няма заявки.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/admin/zayavki/${order.id}`}
                className={`block rounded-md border bg-paper-raised p-4 transition-colors hover:border-ink-300 ${
                  order.status === "new" ? "border-line-strong" : "border-line opacity-80"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="font-semibold text-ink-900">
                    {order.customerName || "Без име"}
                    <span className="ml-2 align-middle font-mono text-sm font-normal text-ink-700">
                      {order.phone}
                    </span>
                    <span
                      className={`ml-2 rounded-sm px-1.5 py-0.5 align-middle text-xs font-semibold ${STATUS_TONE[order.status as InquiryStatus]}`}
                    >
                      {INQUIRY_STATUS_LABEL[order.status as InquiryStatus]}
                    </span>
                  </p>
                  <p className="text-sm text-ink-500 tabular-nums">
                    {order.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </p>
                </div>

                <p className="mt-1 text-sm text-ink-700">
                  {order.productName ?? "(изтрит продукт)"}
                  {order.quantity > 1 && ` · ${order.quantity} бр.`}
                </p>
                {order.notes && (
                  <p className="mt-0.5 line-clamp-1 text-sm text-ink-500">{order.notes}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
