import { afterEach, describe, expect, it, vi } from "vitest";
import { PLACEHOLDER_IMAGE, isPlaceholderImage, resolveImageUrl } from "@/lib/catalog/images";

function env(values: { VERCEL?: string; NEXT_PUBLIC_IMAGE_BASE_URL?: string }) {
  vi.stubEnv("VERCEL", values.VERCEL ?? "");
  vi.stubEnv("NEXT_PUBLIC_IMAGE_BASE_URL", values.NEXT_PUBLIC_IMAGE_BASE_URL ?? "");
}

afterEach(() => vi.unstubAllEnvs());

describe("resolveImageUrl", () => {
  it("serves keys through /media locally with no image host", () => {
    env({});
    expect(resolveImageUrl("ab/cd.jpg")).toBe("/media/ab/cd.jpg");
    expect(resolveImageUrl("/ab/cd.jpg")).toBe("/media/ab/cd.jpg");
  });

  it("falls back to the placeholder on a deployed host with no image host", () => {
    env({ VERCEL: "1" });
    expect(resolveImageUrl("ab/cd.jpg")).toBe(PLACEHOLDER_IMAGE);
  });

  it("uses the image host when configured, locally and deployed", () => {
    env({ NEXT_PUBLIC_IMAGE_BASE_URL: "https://img.example.com/" });
    expect(resolveImageUrl("ab/cd.jpg")).toBe("https://img.example.com/ab/cd.jpg");
    env({ VERCEL: "1", NEXT_PUBLIC_IMAGE_BASE_URL: "https://img.example.com" });
    expect(resolveImageUrl("ab/cd.jpg")).toBe("https://img.example.com/ab/cd.jpg");
  });

  it("rejects foreign absolute URLs and empty input in every configuration", () => {
    for (const config of [{}, { VERCEL: "1" }]) {
      env(config);
      expect(resolveImageUrl("https://other.example.org/a.jpg")).toBe(PLACEHOLDER_IMAGE);
      expect(resolveImageUrl("")).toBe(PLACEHOLDER_IMAGE);
    }
  });
});

describe("isPlaceholderImage", () => {
  it("recognises the placeholder and empty values only", () => {
    expect(isPlaceholderImage(PLACEHOLDER_IMAGE)).toBe(true);
    expect(isPlaceholderImage(null)).toBe(true);
    expect(isPlaceholderImage(undefined)).toBe(true);
    expect(isPlaceholderImage("/media/a.jpg")).toBe(false);
  });
});
