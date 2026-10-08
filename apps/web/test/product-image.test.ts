// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("swaps to the placeholder when loading fails", () => {
    const onError = vi.fn();
    render(createElement(ProductImage, { ...base, src: "/media/a.jpg", onError }));
    fireEvent.error(screen.getByAltText("Кафе"));
    const img = screen.getByAltText("Кафе");
    expect(img.getAttribute("src")).toBe(PLACEHOLDER_IMAGE);
    expect(img.className).toBe("object-contain p-4");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("tries a new source after the previous one failed", () => {
    const { rerender } = render(createElement(ProductImage, { ...base, src: "/media/a.jpg" }));
    fireEvent.error(screen.getByAltText("Кафе"));
    rerender(createElement(ProductImage, { ...base, src: "/media/b.jpg" }));
    expect(screen.getByAltText("Кафе").getAttribute("src")).toBe("/media/b.jpg");
  });
});
