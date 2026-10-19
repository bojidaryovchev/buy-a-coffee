/**
 * A bean that arcs from „Добави“ to the header's cart, which nudges as it
 * lands — DESIGN.md, "Motion" (feedback) and "The Web Vitals rules".
 *
 * Decoration that follows a change already made: the cart has counted up and
 * the notice has spoken before the bean leaves, so nothing waits on it, and
 * under reduced motion it simply does not fly. Transform and opacity only, on
 * an element fixed above the page: nothing in the layout moves. The flight is
 * the Web Animations API, two nested transforms (straight across, up then
 * down), so the arc runs on the compositor. No library.
 *
 * The positions are read when the button is pressed, before the cart changes,
 * and the flight starts on the next frame.
 */

const BEAN_SVG =
  '<svg viewBox="0 0 40 56" width="18" height="25" aria-hidden="true" focusable="false" style="display:block">' +
  '<path d="M20 2C32 2 38 15 38 29C38 44 30 54 20 54C9 54 2 43 2 28C2 14 9 2 20 2Z" style="fill:var(--color-illo-bean-500)"/>' +
  '<path d="M11 10C6.5 16 5.5 25 7.5 34" style="fill:none;stroke:var(--color-illo-bean-300);stroke-width:3;stroke-linecap:round"/>' +
  '<path d="M21.5 5C14 15 14.5 22 19.5 29C24.5 36 24 45 18 52" style="fill:none;stroke:var(--color-illo-bean-700);stroke-width:3.2;stroke-linecap:round"/>' +
  "</svg>";

const DURATION = 700;

/** The header cart a bean can land on, if one is on screen. */
function visibleTarget(): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>("[data-cart-target]")) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight) {
      return element;
    }
  }
  return null;
}

/**
 * Measure now, in the press handler before the cart is changed; returns the
 * launch, to call once the cart really changed. Null when there is nowhere to
 * fly or the visitor asked for less motion.
 */
export function prepareBeanFlight(from: HTMLElement): (() => void) | null {
  if (typeof window === "undefined" || typeof Element.prototype.animate !== "function") return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const target = visibleTarget();
  if (!target) return null;

  const start = from.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  const x0 = start.left + start.width / 2 - 9;
  const y0 = start.top + start.height / 2 - 12;
  const dx = end.left + end.width / 2 - 9 - x0;
  const dy = end.top + end.height / 2 - 12 - y0;
  const peak = Math.min(0, dy) - 70;

  return () =>
    requestAnimationFrame(() => {
      const flyer = document.createElement("span");
      flyer.setAttribute("aria-hidden", "true");
      flyer.style.cssText = `position:fixed;left:${x0}px;top:${y0}px;z-index:60;pointer-events:none;will-change:transform`;
      const bean = document.createElement("span");
      bean.style.cssText = "display:block;will-change:transform";
      bean.innerHTML = BEAN_SVG;
      flyer.appendChild(bean);
      document.body.appendChild(flyer);

      flyer.animate([{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }], {
        duration: DURATION,
        easing: "cubic-bezier(.45,0,.55,1)",
      });
      bean
        .animate(
          [
            { transform: "translateY(0) rotate(0) scale(1)", easing: "cubic-bezier(.2,.6,.4,1)" },
            {
              transform: `translateY(${peak}px) rotate(200deg) scale(1.1)`,
              offset: 0.42,
              easing: "cubic-bezier(.6,0,.85,.4)",
            },
            { transform: `translateY(${dy}px) rotate(380deg) scale(.6)` },
          ],
          { duration: DURATION, fill: "forwards" },
        )
        .finished.then(() => {
          flyer.remove();
          target.animate(
            [
              { transform: "scale(1)" },
              { transform: "scale(1.16) rotate(-6deg)" },
              { transform: "scale(1)" },
            ],
            { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" },
          );
        })
        .catch(() => flyer.remove());
    });
}
