"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { MenuIcon } from "@/components/layout/icons";
import { MobileDrawer } from "@/components/layout/mobile-drawer";
import type { SiteNavigation } from "@/components/layout/navigation";
import type { Dictionary } from "@/i18n/dictionaries/bg";

/** The drawer's words: its own, and the navigation's. */
export interface MobileNavCopy {
  readonly drawer: Dictionary["drawer"];
  readonly nav: Dictionary["nav"];
}

/**
 * Mobile navigation: the menu trigger, and the drawer it opens
 * (`mobile-drawer.tsx`).
 *
 * The trigger is a link to the category index. Without JavaScript nothing can
 * open a drawer, and a menu button that does nothing is the worst control on
 * a phone; a link to the page that lists the same shelves always works. Once
 * the page has hydrated the same element is announced as a button, because
 * from then on that is what it does, with `aria-expanded` and
 * `aria-controls`.
 *
 * The drawer is part of the page's own code, not fetched on demand. It was,
 * for a while, to take its 2 to 3 KB out of the first download, and a tap
 * that came before it then waited for the network with nothing to show for
 * it — a fifth of a second on fast 4G, most of a second on slow — and the
 * drawer opened later, over whatever the visitor had gone on to do. The menu
 * opens on the tap.
 */

const subscribe = (): (() => void) => () => {};

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

  // Any navigation closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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

      {open && (
        <MobileDrawer
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
