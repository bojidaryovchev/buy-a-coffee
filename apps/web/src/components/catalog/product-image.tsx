"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";
import { PLACEHOLDER_IMAGE } from "@/lib/catalog/images";

/**
 * `next/image` that can never show the browser's broken-image icon.
 *
 * The server renders the real image, so the no-JavaScript case and the first
 * paint are unchanged. If the file fails to load, the same element switches to
 * the placeholder. The box is sized by the parent (`fill`) or by explicit
 * dimensions, so the swap does not move anything.
 *
 * A failure can happen before React hydrates, in which case `onError` is never
 * delivered; the mount effect catches that by inspecting the element.
 */
export function ProductImage({ src, onError, ...rest }: ImageProps) {
  const [failedSrc, setFailedSrc] = useState<unknown>(null);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0 && img.currentSrc !== "") {
      setFailedSrc(src);
    }
  }, [src]);

  // Keyed on the failed source so a new `src` (gallery switch) gets a fresh try.
  const failed = failedSrc === src && src !== PLACEHOLDER_IMAGE;

  return (
    <Image
      {...rest}
      ref={ref}
      src={failed ? PLACEHOLDER_IMAGE : src}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
