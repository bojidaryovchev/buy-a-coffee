import Link from "next/link";
import { siteConfig, type CommerceConfig } from "@/config/site";
import { Dismissible } from "@/components/commerce/dismissible";
import { freeDeliveryPromise } from "@/components/commerce/terms";

/**
 * The strip above the header: what delivery costs, and that ordering is one
 * step. The two things a first-time visitor cannot otherwise learn without
 * opening a product.
 *
 * Rendered on the server, so it is in the first byte of HTML and never pops in.
 * It is absent — not empty — when no free-delivery threshold is configured: the
 * bar exists to carry that promise, and a bar without it would be decoration.
 */
export function AnnouncementBar({ commerce = siteConfig.commerce }: { commerce?: CommerceConfig }) {
  const promise = freeDeliveryPromise(commerce);
  if (!promise) return null;

  return (
    <Dismissible
      label="Доставка и поръчка"
      closeLabel="Скрий съобщението"
      className="border-b border-pine-500/25 bg-pine-100"
      innerClassName="shell flex items-center gap-2 py-1 text-pine-900"
    >
      <p className="text-xs sm:text-center">
        <strong className="font-semibold">{promise}</strong>
        <span aria-hidden className="mx-1.5 opacity-60">
          ·
        </span>
        Поръчка на една стъпка — оставяте номер и ние ви звъним.{" "}
        <Link
          href="/delivery"
          className="font-medium whitespace-nowrap underline underline-offset-2 hover:no-underline"
        >
          Доставка и плащане
        </Link>
      </p>
    </Dismissible>
  );
}
