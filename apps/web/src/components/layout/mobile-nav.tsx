"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/config/site";
import { CloseIcon, MachineIcon, MenuIcon, WizardIcon } from "@/components/layout/icons";
import type { SiteNavigation } from "@/components/layout/navigation";
import { Wordmark } from "@/components/layout/wordmark";
import type { Dictionary } from "@/i18n/dictionaries/bg";
import { plural } from "@/i18n/fill";

/** The drawer's words: its own, and the navigation's. */
export interface MobileNavCopy {
  readonly drawer: Dictionary["drawer"];
  readonly nav: Dictionary["nav"];
}

/**
 * Mobile navigation drawer.
 *
 * The rail's structure, in the rail's order, with nothing left out and nothing
 * behind a second tap: the two ways in for someone who knows only their
 * machine, then the capsule systems, then pods and beans, then the rest.
 *
 * Built as a real dialog rather than a shrunken desktop menu:
 *   - focus moves to the close button on open and returns to the trigger on
 *     close,
 *   - Escape, the scrim and any navigation close it,
 *   - focus is trapped while it is open,
 *   - background scrolling is locked,
 *   - the trigger carries `aria-expanded` and `aria-controls`.
 *
 * These are the details that decide whether the menu is usable with a keyboard
 * or a screen reader at all.
 *
 * The trigger is a link to the category index. Without JavaScript nothing can open
 * a drawer, and a menu button that does nothing is the worst control on a
 * phone; a link to the page that lists the same shelves always works. Once the
 * page has hydrated the same element is announced as a button, because from
 * then on that is what it does.
 */

const subscribe = (): (() => void) => () => {};

const ROW =
  "flex min-h-12 items-center gap-2.5 rounded-sm px-3 text-base text-ink-900 hover:bg-paper-sunken";
const ROW_CURRENT =
  "flex min-h-12 items-center gap-2.5 rounded-sm bg-pine-100 px-3 text-base font-medium text-pine-900";
const GROUP_LABEL =
  "px-3 pt-4 pb-1 text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase";

export function MobileNav({
  navigation,
  copy,
  hours,
}: {
  navigation: SiteNavigation;
  copy: MobileNavCopy;
  /** When the phone is answered, already in the page's language. */
  hours: string;
}) {
  const { links } = navigation;
  const { drawer, nav } = copy;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  // Any navigation closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    closeRef.current?.focus();

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
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (!panelRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
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
      trigger?.focus();
    };
  }, [open]);

  const { capsules, pods, beans } = navigation;

  const row = (href: string, children: ReactNode, className = "") => {
    const current = pathname === href;
    return (
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className={`${current ? ROW_CURRENT : ROW} ${className}`}
      >
        {children}
      </Link>
    );
  };

  const count = (value: number) => (
    <span className="text-2xs text-ink-300 tabular-nums">
      {value}
      <span className="sr-only"> {plural(nav.products, value)}</span>
    </span>
  );

  const entry = (href: string, icon: ReactNode, label: string, hint: string) => {
    const current = pathname === href;
    return (
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className={`flex min-h-14 items-center gap-3 rounded-sm border px-3 py-2 ${
          current
            ? "border-pine-500 bg-pine-100 text-pine-900"
            : "border-line-strong bg-paper-raised text-ink-900 hover:bg-paper-sunken"
        }`}
      >
        {icon}
        <span className="min-w-0">
          <span className="block text-base font-medium">{label}</span>
          <span className="block text-xs text-ink-500">{hint}</span>
        </span>
      </Link>
    );
  };

  return (
    <>
      <a
        ref={triggerRef}
        href={links.allCategories.href}
        role={hydrated ? "button" : undefined}
        aria-label={drawer.open}
        aria-expanded={hydrated ? open : undefined}
        aria-controls={hydrated && open ? panelId : undefined}
        onClick={(event) => {
          // A modified click is someone opening the categories page in a new
          // tab, which is what the link says it does.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          // A link answers Enter by itself; a button also answers Space.
          if (event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-ink-700 transition-colors hover:bg-paper-sunken hover:text-ink-900 md:hidden"
      >
        <MenuIcon />
      </a>

      {/*
        Drawn at the end of `body`, not here. The header blurs what is behind
        it, and an element with a backdrop filter becomes the box its fixed
        descendants are positioned in: left inside the header, the drawer
        would be a hundred pixels tall.
      */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-ink-900/40 transition-opacity duration-200 ease-out starting:opacity-0"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-label={drawer.dialog}
              // A link to the page already open changes no path, so the effect
              // above would never hear of it.
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
              }}
              className="absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col overflow-y-auto overscroll-contain bg-paper shadow-float transition-[translate,opacity] duration-200 ease-out starting:-translate-x-full starting:opacity-0"
            >
              <div className="flex items-center justify-between border-b border-line py-2 pr-2 pl-4">
                <Wordmark />
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={drawer.close}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-ink-700 transition-colors hover:bg-paper-sunken hover:text-ink-900"
                >
                  <CloseIcon />
                </button>
              </div>

              <nav aria-label={nav.label} className="flex-1 px-2 py-3">
                <ul className="space-y-2 px-1">
                  <li>
                    {entry(
                      links.findByMachine.href,
                      <MachineIcon className="h-5 w-5 text-pine-700" />,
                      links.findByMachine.label,
                      drawer.findByMachineHint,
                    )}
                  </li>
                  <li>
                    {entry(
                      links.wizard.href,
                      <WizardIcon className="h-5 w-5 text-pine-700" />,
                      links.wizard.label,
                      drawer.wizardHint,
                    )}
                  </li>
                </ul>

                {capsules && (
                  <>
                    <p className={GROUP_LABEL}>{nav.capsulesBySystem}</p>
                    <ul>
                      {capsules.systems.map((system) => (
                        <li key={system.id} data-system={system.id}>
                          {row(
                            system.href,
                            <>
                              <span aria-hidden className="h-2 w-2 shrink-0 bg-(--system)" />
                              <span className="min-w-0 flex-1">{system.name}</span>
                              {count(system.count)}
                            </>,
                          )}
                        </li>
                      ))}
                      <li>
                        {row(
                          capsules.href,
                          nav.allCapsules,
                          pathname === capsules.href ? "" : "font-medium !text-pine-700",
                        )}
                      </li>
                    </ul>
                    <hr className="my-2 border-line" />
                  </>
                )}

                <ul className={capsules ? undefined : "mt-3"}>
                  {pods && (
                    <li>
                      {row(
                        pods.href,
                        <>
                          <span className="min-w-0 flex-1">{pods.name}</span>
                          {count(pods.count)}
                        </>,
                      )}
                    </li>
                  )}
                  {beans && (
                    <li>
                      {row(
                        beans.href,
                        <>
                          <span className="min-w-0 flex-1">{beans.name}</span>
                          {count(beans.count)}
                        </>,
                      )}
                    </li>
                  )}
                  {navigation.otherCategories.map((category) => (
                    <li key={category.href}>
                      {row(
                        category.href,
                        <>
                          <span className="min-w-0 flex-1">{category.label}</span>
                          {count(category.count)}
                        </>,
                      )}
                    </li>
                  ))}
                  <li>{row(navigation.vending.href, navigation.vending.label)}</li>
                  <li>{row(navigation.consumables.href, navigation.consumables.label)}</li>
                </ul>

                <hr className="my-2 border-line" />

                <ul>
                  <li>{row(links.brands.href, links.brands.label)}</li>
                  {navigation.hasPromotions && (
                    <li>
                      {row(
                        links.promotions.href,
                        links.promotions.label,
                        pathname === links.promotions.href ? "" : "!text-clay-600",
                      )}
                    </li>
                  )}
                  {navigation.hasJournal && <li>{row(links.journal.href, links.journal.label)}</li>}
                  <li>{row(links.delivery.href, links.delivery.label)}</li>
                  <li>{row(links.contact.href, links.contact.label)}</li>
                </ul>
              </nav>

              <div className="border-t border-line bg-paper-sunken p-4">
                <a
                  href={`tel:${siteConfig.contact.phoneHref}`}
                  className="inline-flex min-h-11 items-center text-base font-medium text-pine-700 tabular-nums underline-offset-4 hover:underline"
                >
                  {siteConfig.contact.phone}
                </a>
                {hours && <p className="text-sm text-ink-500">{hours}</p>}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
