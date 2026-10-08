"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { buttonClasses } from "@/components/ui/primitives";

/*
 * The dialog, and the order form inside it, are fetched the first time any
 * card's control is used and mounted for that one product. A listing of
 * twenty-four cards therefore ships twenty-four copies of this small link and
 * no copy of the form.
 */
const QuickOrderDialog = dynamic(
  () => import("@/components/catalog/quick-order-dialog").then((module) => module.QuickOrderDialog),
  { ssr: false },
);

/**
 * "Бърза поръчка" on a product card.
 *
 * It is a link first: to the order form on the product page, which is where it
 * goes without JavaScript, before hydration, and on a click that asks for a new
 * tab. JavaScript upgrades a plain click to opening the same form in a dialog,
 * so an order from a listing takes two interactions instead of a page load.
 *
 * It is a sibling of the card's product link, never a descendant: an
 * interactive element inside a link has no defined behaviour and is announced
 * unpredictably.
 */
export function QuickOrderControl({
  slug,
  name,
  className,
}: {
  readonly slug: string;
  /** The product's name: read after the label, and shown in the dialog's heading. */
  readonly name: string;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Back to where the visitor was, so the keyboard does not restart the page.
    linkRef.current?.focus();
  }, []);

  return (
    <>
      <Link
        ref={linkRef}
        href={`/products/${slug}#order`}
        // The name link above already prefetches this product's page.
        prefetch={false}
        onClick={(event) => {
          // A modified click is a request for a new tab or window: let it be one.
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.button !== 0
          ) {
            return;
          }
          event.preventDefault();
          setOpen(true);
        }}
        className={buttonClasses({ variant: "secondary", size: "sm", className })}
      >
        <span>
          Бърза поръчка<span className="sr-only">: {name}</span>
        </span>
      </Link>

      {open && <QuickOrderDialog slug={slug} name={name} onClose={close} />}
    </>
  );
}
