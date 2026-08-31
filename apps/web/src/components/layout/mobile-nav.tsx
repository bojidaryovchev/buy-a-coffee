"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CategoryView } from "@/lib/catalog/types";
import { siteConfig } from "@/config/site";

/**
 * Mobile navigation drawer.
 *
 * Built as a real dialog rather than a shrunken desktop menu:
 *   - focus moves into the panel on open and returns to the trigger on close,
 *   - Escape closes it,
 *   - focus is trapped while it is open,
 *   - background scrolling is locked,
 *   - the trigger carries `aria-expanded` and `aria-controls`.
 *
 * These are the details that decide whether the menu is usable with a keyboard
 * or a screen reader at all.
 */
export function MobileNav({ categories }: { categories: readonly CategoryView[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Any navigation closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
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
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Отвори менюто"
        className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-sm text-ink-700 hover:bg-paper-sunken md:hidden"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Меню на сайта"
            className="absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col overflow-y-auto bg-paper shadow-float"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              <span className="font-display text-lg font-semibold">Меню</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Затвори менюто"
                className="inline-flex h-10 w-10 items-center justify-center rounded-sm text-ink-700 hover:bg-paper-sunken"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <nav aria-label="Сайт" className="flex-1 px-2 py-3">
              <ul className="space-y-0.5">
                {categories.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={`/categories/${category.slug}`}
                      className="flex items-center justify-between rounded-sm px-3 py-3 text-base font-medium text-ink-900 hover:bg-paper-sunken"
                    >
                      {category.name}
                      <span className="text-xs text-ink-300">{category.productCount}</span>
                    </Link>
                    {category.children.length > 0 && (
                      <ul className="mb-1 ml-3 border-l border-line pl-3">
                        {category.children.map((child) => (
                          <li key={child.slug}>
                            <Link
                              href={`/categories/${child.slug}`}
                              className="flex items-center justify-between rounded-sm px-3 py-2.5 text-sm text-ink-700 hover:bg-paper-sunken"
                            >
                              {child.name}
                              <span className="text-2xs text-ink-300">{child.productCount}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>

              <hr className="my-3 border-line" />

              <ul className="space-y-0.5">
                <li>
                  <Link href="/wizard" className="block rounded-sm px-3 py-3 text-base font-medium hover:bg-paper-sunken">
                    Кое кафе е за вас
                  </Link>
                </li>
                <li>
                  <Link href="/brands" className="block rounded-sm px-3 py-3 text-base font-medium hover:bg-paper-sunken">
                    Марки
                  </Link>
                </li>
                <li>
                  <Link
                    href="/promotions"
                    className="block rounded-sm px-3 py-3 text-base font-medium text-clay-600 hover:bg-paper-sunken"
                  >
                    Промоции
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="block rounded-sm px-3 py-3 text-base font-medium hover:bg-paper-sunken">
                    Контакти
                  </Link>
                </li>
              </ul>
            </nav>

            <div className="border-t border-line px-5 py-4">
              <a href={`tel:${siteConfig.contact.phoneHref}`} className="text-base font-medium text-pine-700">
                {siteConfig.contact.phone}
              </a>
              <p className="mt-0.5 text-xs text-ink-500">{siteConfig.contact.hours}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
