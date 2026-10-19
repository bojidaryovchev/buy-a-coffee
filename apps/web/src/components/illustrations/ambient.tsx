"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Class names, joined; kept here so the primitives can draw these without an import cycle. */
const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/**
 * Holds an ambient loop — the steam — and pauses it whenever it is off-screen.
 *
 * DESIGN.md, "The Unseen Loop Rule": the loop is CSS (`.steam-wisp` in
 * `globals.css`); this only sets `data-offscreen` while the box is outside the
 * viewport, which sets `animation-play-state: paused` on what it holds. A
 * hidden tab needs nothing: browsers stop painting animations there already.
 * Without JavaScript the steam simply keeps going, which costs nothing anyone
 * can see.
 */
export function Ambient({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) delete box.dataset.offscreen;
      else box.dataset.offscreen = "";
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className={cx("block", className)}>
      {children}
    </span>
  );
}
