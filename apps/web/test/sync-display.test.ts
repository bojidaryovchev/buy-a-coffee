import { describe, expect, it } from "vitest";
import {
  changeTypeLabel,
  formatAgo,
  formatDuration,
  optionalCount,
  runStatusLabel,
} from "@/lib/sync-display";

const NOW = new Date("2026-10-10T12:00:00Z");
const before = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatAgo", () => {
  it.each([
    [10_000, "току-що"],
    [MIN, "преди 1 минута"],
    [5 * MIN, "преди 5 минути"],
    [HOUR, "преди 1 час"],
    [5 * HOUR + 59 * MIN, "преди 5 часа"],
    [DAY, "преди 1 ден"],
    [70 * DAY, "преди 70 дни"],
  ])("%i ms -> %s", (ms, expected) => {
    expect(formatAgo(before(ms), NOW)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it("handles seconds, minutes and an unfinished run", () => {
    expect(formatDuration(14_000)).toBe("14 сек");
    expect(formatDuration(125_000)).toBe("2 мин 05 сек");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("labels", () => {
  it("translates known values and passes unknown ones through", () => {
    expect(runStatusLabel("partial")).toBe("Частична");
    expect(runStatusLabel("exploded")).toBe("exploded");
    expect(changeTypeLabel("moved")).toBe("Преместен");
    expect(changeTypeLabel("teleported")).toBe("teleported");
  });
});

describe("optionalCount", () => {
  it("reads a column when it exists and is a number", () => {
    expect(optionalCount({ movedCount: 3 }, "movedCount")).toBe(3);
    expect(optionalCount({}, "movedCount")).toBeNull();
    expect(optionalCount({ movedCount: "3" }, "movedCount")).toBeNull();
  });
});
