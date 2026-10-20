"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { MenuIcon } from "@/components/layout/icons";
import type { SiteNavigation } from "@/components/layout/navigation";
import type { Dictionary } from "@/i18n/dictionaries/bg";
import { deferredModule, useDeferredModule } from "@/lib/after-load";

/** The drawer's words: its own, and the navigation's. */
export interface MobileNavCopy {
  readonly drawer: Dictionary["drawer"];
  readonly nav: Dictionary["nav"];
}

/**
 * Mobile navigation: the menu trigger, and the drawer it opens.
 *
 * The trigger is a link to the category index. Without JavaScript nothing can
 * open a drawer, and a menu button that does nothing is the worst control on
 * a phone; a link to the page that lists the same shelves always works. Once
 * the page has hydrated the same element is announced as a button, because
 * from then on that is what it does, with `aria-expanded` and
 * `aria-controls`.
 *
 * The drawer (`mobile-drawer.tsx`) is not part of the page's first download.
 * It is fetched on the first idle moment after the page has loaded — on a
 * phone, where the trigger is drawn — and at the latest when a finger lands on
 * the trigger: `pointerdown` comes a beat before the `click` that opens it, so
 * the click finds the drawer ready, or waits the moment it takes. Should the
 * fetch fail (a dropped connection), the trigger does what its link says and
 * goes to the category index.
 */

const subscribe = (): (() => void) => () => {};

const DRAWER = deferredModule(() => import("@/components/layout/mobile-drawer"));

/** Ask for the drawer now: someone is reaching for the trigger. */
const prepare = () => {
  DRAWER.load().catch(() => undefined);
};

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
  const { drawer } = copy;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  // From `md` up the trigger is hidden and nothing can open the drawer.
  const loaded = useDeferredModule(
    DRAWER,
    () => (triggerRef.current?.getClientRects().length ?? 0) > 0,
  );
  const expanded = open && loaded !== undefined;

  // Any navigation closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const show = () => {
    setOpen(true);
    DRAWER.load().catch(() => {
      setOpen(false);
      window.location.assign(links.allCategories.href);
    });
  };

  return (
    <>
      <a
        ref={triggerRef}
        href={links.allCategories.href}
        role={hydrated ? "button" : undefined}
        aria-label={drawer.open}
        aria-expanded={hydrated ? expanded : undefined}
        aria-controls={hydrated && expanded ? panelId : undefined}
        onPointerDown={prepare}
        onFocus={prepare}
        onClick={(event) => {
          // A modified click is someone opening the categories page in a new
          // tab, which is what the link says it does.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          show();
        }}
        onKeyDown={(event) => {
          // A link answers Enter by itself; a button also answers Space.
          if (event.key === " ") {
            event.preventDefault();
            show();
          }
        }}
        className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-ink-700 transition-colors hover:bg-paper-sunken hover:text-ink-900 md:hidden"
      >
        <MenuIcon />
      </a>

      {expanded && (
        <loaded.MobileDrawer
          id={panelId}
          navigation={navigation}
          copy={copy}
          hours={hours}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
