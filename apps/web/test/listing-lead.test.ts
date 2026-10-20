import { describe, expect, it } from "vitest";
import { categoryCopy } from "../content/category-copy";

/*
 * Milestone 1, stage one (research `09`): the four system and format pages
 * whose searches are mostly typed in Cyrillic get the Cyrillic form in their
 * heading and a lead above the products in the searched words. The other four
 * keep their heading and have no lead until a later release, so the two
 * groups can be compared — observationally: the release also changes things
 * that reach every page, so this is not a controlled experiment.
 */

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

const TREATED = {
  "dolce-gusto": { h1: "Долче Густо", lead: ["капсулите долче густо", "съвместими", "neo"] },
  nespresso: { h1: "Неспресо", lead: ["капсулите неспресо", "съвместими", "vertuo"] },
  "kafe-na-zyrna": { h1: "Кафе на зърна", lead: ["кафе на зърна", "1 кг"] },
  "kafe-dozi": { h1: "Кафе дози", lead: ["ese капсули", "дозети", "44 мм"] },
} as const;

/* Their headings as released before stage one, held word for word. */
const HELD_BACK = {
  "lavazza-blue": "Капсули за Lavazza Blue",
  "a-modo-mio": "Капсули за Lavazza A Modo Mio",
  caffitaly: "Капсули Caffitaly",
  "kafe-kapsuli": "Кафе капсули",
} as const;

describe("the treated listings", () => {
  it.each(Object.entries(TREATED))(
    "%s heads in Cyrillic and leads in the searched words",
    (key, want) => {
      const copy = categoryCopy[key]!;
      expect(copy.h1).toContain(want.h1);
      expect(copy.lead, key).toBeDefined();
      const lead = copy.lead!;
      expect(words(lead), lead).toBeGreaterThanOrEqual(40);
      expect(words(lead), lead).toBeLessThanOrEqual(60);
      for (const phrase of want.lead) expect(lead.toLowerCase(), phrase).toContain(phrase);
    },
  );

  it("keeps the Latin system name in the heading beside the Cyrillic one", () => {
    expect(categoryCopy["dolce-gusto"]!.h1).toBe("Капсули за Dolce Gusto (Долче Густо)");
    expect(categoryCopy.nespresso!.h1).toBe("Капсули, съвместими с Nespresso (Неспресо)");
  });
});

describe("the listings held back", () => {
  it.each(Object.entries(HELD_BACK))("%s keeps its heading and has no lead", (key, h1) => {
    expect(categoryCopy[key]!.h1).toBe(h1);
    expect(categoryCopy[key]!.lead).toBeUndefined();
  });

  it("is everything else with copy: no listing outside the two groups has a lead", () => {
    const grouped = new Set<string>([...Object.keys(TREATED), ...Object.keys(HELD_BACK)]);
    const others = Object.entries(categoryCopy).filter(
      ([key, copy]) => !grouped.has(key) && copy.lead !== undefined,
    );
    expect(others).toEqual([]);
  });
});
