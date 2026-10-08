"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { IMAGE_SIZES } from "@/lib/catalog/images";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { ProductImage } from "@/components/catalog/product-image";
import { cx } from "@/components/ui/primitives";
import type { ProductImageView } from "@/lib/catalog/types";

/**
 * Product gallery. DESIGN.md, "Product page", left column.
 *
 * Every photograph is in the server-rendered markup, side by side in one
 * horizontal snap scroller, so all of them can be reached with JavaScript off:
 * on a phone by swiping, from `md` up through the thumbnails, which are links
 * to each image's own anchor (a fragment link scrolls the scroller to it). The
 * script only takes over what the browser would do anyway — a thumbnail
 * scrolls the scroller instead of jumping the page, and the selected
 * thumbnail follows whichever image is in view.
 *
 * On a phone the position is the "1 / 3" under each image. It is printed into
 * every slide rather than kept in one counter under the scroller, so it is
 * right with no script at all: it scrolls in with the image it counts.
 *
 * The first image is `priority` because it is the largest-contentful-paint
 * element on the page; the rest are lazy. Every well declares its aspect
 * ratio, so nothing shifts as they load.
 *
 * The wells are pure white and unpadded: the photographs were taken on white
 * and carry their own margin, so a tinted or padded well draws a rectangle
 * around every one of them.
 */

/** The anchor of the image at `index` (zero-based). */
export function galleryImageId(baseId: string, index: number): string {
  return `${baseId}-${index + 1}`;
}

export function ProductGallery({
  images,
  productName,
}: {
  images: readonly ProductImageView[];
  productName: string;
}) {
  const reactId = useId();
  // `useId` output contains colons, which a fragment URL would carry verbatim.
  const baseId = `snimka${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const count = images.length;

  /** The slide nearest the scroller's left edge. */
  const syncActive = useCallback(() => {
    const scroller = scrollerRef.current;
    const slides = scroller?.children;
    if (!scroller || !slides || slides.length < 2) return;
    const step = (slides[1] as HTMLElement).offsetLeft - (slides[0] as HTMLElement).offsetLeft;
    if (step <= 0) return;
    const index = Math.round(scroller.scrollLeft / step);
    setActiveIndex(Math.min(Math.max(index, 0), slides.length - 1));
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || count < 2) return;
    // A visitor who swiped or followed a thumbnail before hydration.
    syncActive();
    scroller.addEventListener("scroll", syncActive, { passive: true });
    return () => scroller.removeEventListener("scroll", syncActive);
  }, [count, syncActive]);

  if (count === 0) {
    return (
      <div className="relative aspect-square overflow-hidden rounded-md border border-line">
        <ImagePlaceholder />
      </div>
    );
  }

  if (count === 1) {
    const image = images[0]!;
    return (
      <figure className="relative aspect-square overflow-hidden rounded-md border border-line bg-well">
        <ProductImage
          src={image.url}
          alt={image.alt || productName}
          fill
          sizes={IMAGE_SIZES.detail}
          priority
          className="object-contain"
        />
      </figure>
    );
  }

  const showImage = (index: number) => {
    const scroller = scrollerRef.current;
    const slide = scroller?.children[index] as HTMLElement | undefined;
    if (!scroller || !slide) return false;
    // `behavior` is left to the stylesheet, which drops smooth scrolling
    // under reduced motion.
    scroller.scrollTo({ left: slide.offsetLeft });
    setActiveIndex(index);
    return true;
  };

  return (
    <div>
      <div
        ref={scrollerRef}
        role="region"
        aria-label={`Снимки: ${productName}`}
        // Reachable by keyboard, so the arrow keys can scroll it on a phone,
        // where there are no thumbnails to tab to.
        tabIndex={0}
        className="relative flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain rounded-md motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((image, index) => (
          <figure
            key={image.url}
            id={galleryImageId(baseId, index)}
            aria-label={`Снимка ${index + 1} от ${count}`}
            className="w-full shrink-0 snap-start"
          >
            <div className="relative aspect-square overflow-hidden rounded-md border border-line bg-well">
              <ProductImage
                src={image.url}
                alt={image.alt || productName}
                fill
                sizes={IMAGE_SIZES.detail}
                priority={index === 0}
                loading={index === 0 ? undefined : "lazy"}
                className="object-contain"
              />
            </div>
            <figcaption
              aria-hidden
              className="mt-2 text-center text-xs text-ink-500 tabular-nums md:hidden"
            >
              {index + 1} / {count}
            </figcaption>
          </figure>
        ))}
      </div>

      <ul className="mt-3 hidden flex-wrap gap-2 md:flex" role="list">
        {images.map((image, index) => {
          const selected = index === activeIndex;
          return (
            <li key={image.url}>
              <a
                href={`#${galleryImageId(baseId, index)}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                    return;
                  if (showImage(index)) event.preventDefault();
                }}
                aria-label={`Снимка ${index + 1} от ${count}`}
                aria-current={selected ? "true" : undefined}
                className={cx(
                  "relative block h-16 w-16 overflow-hidden rounded-sm bg-well transition-colors",
                  selected
                    ? "border-2 border-pine-700"
                    : "border border-line hover:border-pine-500",
                )}
              >
                <ProductImage
                  src={image.url}
                  alt=""
                  fill
                  sizes="64px"
                  loading="lazy"
                  placeholderLabel={false}
                  className="object-contain"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
