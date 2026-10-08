"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { isPlaceholderImage } from "@/lib/catalog/images";

/**
 * `next/image` that can never show the browser's broken-image icon.
 *
 * The server renders the real image, so the no-JavaScript case and the first
 * paint are unchanged. If the file fails to load, the photograph is replaced by
 * the same `ImagePlaceholder` a product with no photograph shows, so "there is
 * no picture" looks the same whichever way it came about (DESIGN.md, "Image
 * placeholder"). A source that already resolved to the placeholder file — a
 * URL that is not on our own host — gets the same drawing without a request.
 *
 * The placeholder fills a positioned parent, which is the box `fill` images
 * already sit in. An image with explicit dimensions gets a box of its own of
 * that size, so the swap does not move anything either way.
 *
 * A failure can happen before React hydrates, in which case `onError` is never
 * delivered; the mount effect catches that by inspecting the element.
 */
export function ProductImage({
  src,
  onError,
  placeholderLabel = true,
  ...rest
}: ImageProps & {
  /**
   * Whether the placeholder prints "Няма снимка". Pass `false` for a well
   * under 96 px wide (typeahead rows, thumbnails); see `ImagePlaceholder`.
   */
  readonly placeholderLabel?: boolean | "from-sm";
}) {
  const [failedSrc, setFailedSrc] = useState<unknown>(null);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0 && img.currentSrc !== "") {
      setFailedSrc(src);
    }
  }, [src]);

  // Keyed on the failed source so a new `src` (gallery switch) gets a fresh try.
  const failed = failedSrc === src;

  if (failed || (typeof src === "string" && isPlaceholderImage(src))) {
    if (rest.fill) return <ImagePlaceholder label={placeholderLabel} />;
    return (
      <span
        className="relative inline-block align-middle"
        style={{ width: Number(rest.width) || undefined, height: Number(rest.height) || undefined }}
      >
        <ImagePlaceholder label={placeholderLabel} />
      </span>
    );
  }

  return (
    <Image
      {...rest}
      ref={ref}
      src={src}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
