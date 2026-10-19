"use client";

import { useEffect } from "react";

/**
 * Switches the scroll-driven motion on once the page has loaded and the main
 * thread has had an idle moment: it sets `data-motion` on `<html>`, which the
 * `view()` rules in `globals.css` wait for. DESIGN.md, "The Quiet Load Rule".
 *
 * Measured on Pixel 7, Fast 4G and a 4x CPU: with the timelines present while
 * the page loaded, the home page's LCP came about 500 ms later and a listing's
 * first paint 100 to 160 ms later; switched on after load they cost neither.
 * By then the rising tiles and the curl are below the fold, so nothing a
 * reader is looking at jumps. Without JavaScript the flag never comes, and
 * everything is simply in place — as where `animation-timeline` is not
 * supported. Set once per visit; a client-side navigation keeps it.
 */
export function MotionGate() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.motion !== undefined) return;

    let idle: number | undefined;
    let timer: number | undefined;
    const on = () => {
      root.dataset.motion = "";
    };
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(on, { timeout: 2000 });
      } else {
        timer = window.setTimeout(on, 200);
      }
    };

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
      window.removeEventListener("load", schedule);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
