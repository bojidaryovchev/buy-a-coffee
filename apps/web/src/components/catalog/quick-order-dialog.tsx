"use client";

import { useEffect, useId, useRef } from "react";
import { QuickOrderForm } from "@/components/forms/quick-order-form";
import { buttonClasses } from "@/components/ui/primitives";

/** Everything Tab might land on; the handler then drops what it cannot. */
const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";

/**
 * The order form for one product, in a modal dialog.
 *
 * A native `<dialog>` opened with `showModal()`. The browser then does the
 * parts that are easy to get wrong by hand: the rest of the page is inert, so
 * focus cannot leave the dialog; Escape closes it; and it sits in the top
 * layer, above everything, whatever the stacking context of the card that
 * opened it.
 *
 * Mounted only while open (see `QuickOrderControl`), so it always opens with a
 * fresh form, and a listing never holds more than one.
 */
export function QuickOrderDialog({
  slug,
  name,
  onClose,
}: {
  readonly slug: string;
  readonly name: string;
  /** Called once the dialog has closed, however it was closed. */
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  /*
   * Where the pointer went down. A drag that starts in a field and ends over
   * the backdrop — selecting a phone number, say — is not a request to close.
   */
  const pressStartedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    // The page behind a modal should not scroll under it.
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Fired for Escape, for the close button and for a backdrop click alike.
      onClose={onClose}
      onKeyDown={(event) => {
        /*
         * A modal dialog already makes the page behind it inert, but the
         * browser still lets Tab step out to its own toolbar and back. Wrapping
         * at the two ends keeps the keyboard inside the dialog until it closes.
         */
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter(
          // Not the honeypot (`tabindex="-1"`), nothing disabled, nothing hidden.
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            element.getClientRects().length > 0,
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onMouseDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        /*
         * The dialog has no padding of its own, so a click whose target is the
         * dialog element itself can only have landed on the backdrop.
         */
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) {
          event.currentTarget.close();
        }
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-lg border border-line bg-paper-raised p-0 text-ink-900 shadow-float backdrop:bg-ink-900/40"
    >
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="min-w-0">
            <span className="block font-display text-lg font-semibold text-ink-900 md:text-xl">
              Бърза поръчка
            </span>
            <span className="mt-1 block font-sans text-sm font-medium tracking-normal text-ink-700">
              {name}
            </span>
          </h2>

          <button
            type="button"
            aria-label="Затвори"
            onClick={() => dialogRef.current?.close()}
            className={buttonClasses({
              variant: "ghost",
              size: "sm",
              className: "-mt-1 -mr-1 min-h-10 w-10 shrink-0 px-0",
            })}
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        {/*
          The form draws its own bordered panel, which is right on the product
          page and would be a card inside a card here. The dialog is the panel,
          so the form's frame is dropped from outside rather than by changing
          the form.
        */}
        <div className="mt-4 border-t border-line pt-4 [&>form]:rounded-none [&>form]:border-0 [&>form]:p-0">
          <QuickOrderForm productSlug={slug} />
        </div>
      </div>
    </dialog>
  );
}
