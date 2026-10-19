"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ButtonLink, buttonClasses } from "@/components/ui/primitives";
import { CloseIcon } from "@/components/layout/icons";
import { useLocale } from "@/i18n/use-locale";
import { cartStore, type AddedEvent } from "@/lib/cart/store";
import { href, routes } from "@/lib/routes";

/** How long the notice stays when nobody is looking at it. */
const SHOW_MS = 6000;

/**
 * „Добавено в количката“: the answer to every add-to-cart press on the page.
 *
 * One for the whole frame, fed by the store (`cartStore.onAdded`), so a listing
 * of twenty-four cards has one notice and not twenty-four. It floats at the
 * foot of the screen — the one place on a phone that is neither the header
 * nor the card that was pressed — on white with the float shadow, as anything
 * above the page does (DESIGN.md, "Elevation").
 *
 * It is the customer's own action answered, not a pop-up: it never appears
 * unprompted, never takes focus, and goes by itself. It stays while the
 * pointer or the keyboard is in it, so „Към количката“ can be reached, and
 * Escape or its close button dismiss it. It belongs to the page it was raised
 * on: the frame stays mounted across a client-side navigation, and on the next
 * page — the cart, most often — it would be an answer to nothing there. The
 * region is always in the page and polite, so a screen reader hears „Добавено
 * в количката: …“ without being moved anywhere.
 */
export function CartNotice() {
  const [shown, setShown] = useState<{ event: AddedEvent; path: string | null } | null>(null);
  const [held, setHeld] = useState(false);
  const locale = useLocale();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);

  /* The page an add happens on. Read through a ref, because the store's
     listener is attached once and would otherwise remember the first page. */
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  useEffect(() => cartStore.onAdded((event) => setShown({ event, path: path.current })), []);

  const event = shown && shown.path === pathname ? shown.event : null;

  // Gone however it went; the next notice starts unheld.
  const dismiss = () => {
    setShown(null);
    setHeld(false);
  };

  useEffect(() => {
    if (!event || held) return;
    const timer = setTimeout(() => setShown(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [event, held]);

  useEffect(() => {
    if (!event) return;
    const onKey = (key: KeyboardEvent) => {
      if (key.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [event]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 md:justify-end md:p-6"
    >
      {event && (
        <div
          ref={panelRef}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={(blur) => {
            if (!panelRef.current?.contains(blur.relatedTarget as Node | null)) setHeld(false);
          }}
          className="pointer-events-auto w-full max-w-sm rounded-md border border-line bg-paper-raised p-4 shadow-float"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {event.added ? (
                <>
                  <p className="text-sm font-semibold text-ink-900">Добавено в количката</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-ink-700">
                    {event.quantity > 1 && (
                      <span className="tabular-nums">{event.quantity} × </span>
                    )}
                    {event.name}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-ink-900">Количката е пълна</p>
                  <p className="mt-0.5 text-sm text-ink-700">
                    Изпратете заявката за това, което е в нея, или махнете продукт, за да добавите
                    друг.
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              aria-label="Затвори"
              onClick={dismiss}
              className={buttonClasses({
                variant: "ghost",
                size: "sm",
                className: "-mt-2 -mr-2 min-h-11 w-11 shrink-0 px-0 lg:min-h-10 lg:w-10",
              })}
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <ButtonLink
            href={href(locale, routes.cart)}
            size="sm"
            className="mt-3 w-full"
            onClick={dismiss}
          >
            Към количката
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
