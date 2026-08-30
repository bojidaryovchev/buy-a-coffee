"use client";

import Image from "next/image";
import { useState } from "react";
import { IMAGE_SIZES, PLACEHOLDER_IMAGE } from "@/lib/catalog/images";
import { cx } from "@/components/ui/primitives";
import type { ProductImageView } from "@/lib/catalog/types";

/**
 * Product gallery.
 *
 * A client component only because switching the active image needs state. With
 * a single image — which is the case for the entire current catalog — it
 * renders a plain figure with no thumbnails and no interactive controls, so
 * the common case costs nothing extra.
 *
 * The main image is `priority` because it is the largest-contentful-paint
 * element on the page, and every image declares an aspect ratio so nothing
 * shifts as it loads.
 */
export function ProductGallery({
  images,
  productName,
}: {
  images: readonly ProductImageView[];
  productName: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex] ?? images[0];

  if (images.length === 0) {
    return (
      <div className="relative aspect-square overflow-hidden rounded-md border border-line bg-paper-sunken">
        <Image
          src={PLACEHOLDER_IMAGE}
          alt=""
          fill
          sizes={IMAGE_SIZES.detail}
          className="object-contain p-12 opacity-40"
        />
        <span className="sr-only">Няма изображение за {productName}</span>
      </div>
    );
  }

  return (
    <div>
      <figure className="relative aspect-square overflow-hidden rounded-md border border-line bg-paper-sunken">
        <Image
          key={active?.url}
          src={active?.url ?? PLACEHOLDER_IMAGE}
          alt={active?.alt ?? productName}
          fill
          sizes={IMAGE_SIZES.detail}
          priority
          className="object-contain p-8"
        />
      </figure>

      {images.length > 1 && (
        <ul className="mt-3 flex gap-2" role="list">
          {images.map((image, index) => (
            <li key={image.url}>
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Покажи изображение ${index + 1} от ${images.length}`}
                aria-current={index === activeIndex}
                className={cx(
                  "relative block h-20 w-20 overflow-hidden rounded-sm border bg-paper-sunken",
                  index === activeIndex ? "border-pine-700" : "border-line hover:border-line-strong",
                )}
              >
                <Image
                  src={image.url}
                  alt=""
                  fill
                  sizes={IMAGE_SIZES.thumb}
                  loading="lazy"
                  className="object-contain p-1.5"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
