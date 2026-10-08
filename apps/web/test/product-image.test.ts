// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { ProductImage } from "@/components/catalog/product-image";
import { PLACEHOLDER_IMAGE } from "@/lib/catalog/images";

vi.mock("next/image", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function Img(props, ref) {
      const { fill: _fill, priority: _priority, ...rest } = props;
      return React.createElement("img", { ref, ...rest });
    }),
  };
});

afterEach(cleanup);

const base = { alt: "Кафе", sizes: "50vw", className: "object-contain p-4", fill: true as const };

describe("ProductImage", () => {
  it("renders the given source and keeps alt, sizes and classes", () => {
    render(createElement(ProductImage, { ...base, src: "/media/a.jpg" }));
    const img = screen.getByAltText("Кафе");
    expect(img.getAttribute("src")).toBe("/media/a.jpg");
    expect(img.getAttribute("sizes")).toBe("50vw");
    expect(img.className).toBe("object-contain p-4");
  });

  /*
   * A photograph that fails to load looks exactly like a product that has no
   * photograph: the same drawing on the sunken tone, the same words, and no
   * broken image left behind. DESIGN.md, "Image placeholder".
   */
  it("swaps to the image placeholder when loading fails", () => {
    const onError = vi.fn();
    const { container } = render(
      createElement(ProductImage, { ...base, src: "/media/a.jpg", onError }),
    );
    fireEvent.error(screen.getByAltText("Кафе"));
    expect(container.querySelector("img")).toBeNull();
    const failed = container.innerHTML;

    const { container: missing } = render(createElement(ImagePlaceholder));
    expect(failed).toBe(missing.innerHTML);
    expect(failed).toContain("bg-paper-sunken");
    expect(screen.getAllByText("Няма снимка")).toHaveLength(2);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("drops the words where the well is too small for them", () => {
    const { container } = render(
      createElement(ProductImage, { ...base, src: "/media/a.jpg", placeholderLabel: false }),
    );
    fireEvent.error(screen.getByAltText("Кафе"));
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("draws the placeholder, not the old file, for a source that is not ours", () => {
    const { container } = render(createElement(ProductImage, { ...base, src: PLACEHOLDER_IMAGE }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("Няма снимка");
  });

  it("gives an image with explicit dimensions a placeholder box of the same size", () => {
    const { container } = render(
      createElement(ProductImage, { alt: "Кафе", src: "/media/a.jpg", width: 40, height: 40 }),
    );
    fireEvent.error(screen.getByAltText("Кафе"));
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.width).toBe("40px");
    expect(box.style.height).toBe("40px");
    expect(box.className).toContain("relative");
  });

  it("tries a new source after the previous one failed", () => {
    const { rerender } = render(createElement(ProductImage, { ...base, src: "/media/a.jpg" }));
    fireEvent.error(screen.getByAltText("Кафе"));
    rerender(createElement(ProductImage, { ...base, src: "/media/b.jpg" }));
    expect(screen.getByAltText("Кафе").getAttribute("src")).toBe("/media/b.jpg");
  });
});
