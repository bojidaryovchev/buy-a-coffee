import { describe, expect, it } from "vitest";
import { MACHINE_BRANDS, getMachineModel } from "@/content/machines";
import { compatibleMachines } from "@/lib/catalog/product-facts";
import { parseWizardAnswers, wizardHref } from "@/lib/recommend/answers";

/**
 * The illy X7.1, held to what illy says it is.
 *
 * Until 20 October 2026 the machine database listed „X7.1 (версия за дози)“
 * under ESE pods, with no source. illy makes the X7.1 for its iperEspresso
 * capsules only and publishes no E.S.E. version, so an owner was told that
 * pods fit and could order a box that does not go in the machine. These tests
 * keep that from coming back by any of the three ways it reached a customer:
 * the machine database, the wizard, and the „Става за тези машини“ list on a
 * pod's product page.
 */

const illy = MACHINE_BRANDS.find((brand) => brand.slug === "illy")!;
const x7 = illy.models.filter((model) => /x7/i.test(`${model.slug} ${model.name}`));

describe("the illy X7.1 in the machine database", () => {
  it("is listed, and only as the Iperespresso machine", () => {
    expect(x7.map((model) => model.slug)).toEqual(["illy-x7"]);
    for (const model of x7) {
      expect(model.system, model.slug).toBe("illy-iperespresso");
      expect(model.system, model.slug).not.toBe("ese-pod");
    }
  });

  it("answers under its old slug as the machine it is now", () => {
    expect(getMachineModel("illy-x7-ese")?.model.slug).toBe("illy-x7");
    expect(getMachineModel("illy-x7-ese")?.model.system).toBe("illy-iperespresso");
  });
});

describe("the wizard and the illy X7.1", () => {
  /*
   * The wizard recommends only once it has a system, and a machine never
   * supplies one: so for the X7.1, under either slug, with or without a pod
   * system in the link, the system must come out empty.
   */
  const LINKS = [
    { machine: "illy-x7" },
    { machine: "illy-x7", system: "ese-pod" },
    { machine: "illy-x7", system: "ese-pod", brew: "pod" },
    { machine: "illy-x7-ese" },
    { machine: "illy-x7-ese", system: "ese-pod" },
    { machine: "illy-x7-ese", system: "ese-pod", brew: "pod" },
    {
      machine: "illy-x7-ese",
      system: "ese-pod",
      brew: "pod",
      taste: "intense",
      volume: "light",
    },
  ] as const;

  it("reads a full answered link as answers, so the cases above are not empty by accident", () => {
    const full = parseWizardAnswers({
      system: "ese-pod",
      brew: "pod",
      taste: "intense",
      volume: "light",
    });
    expect(full.system).toBe("ese-pod");
    expect(full.taste).toBe("intense");
  });

  it.each(LINKS.map((link) => [new URLSearchParams(link).toString(), link] as const))(
    "never answers the pod system for %s",
    (_, link) => {
      const answers = parseWizardAnswers(link);
      // The link is read, not thrown away whole: only the machine/system pair goes.
      if ("brew" in link) expect(answers.brew).toBe("pod");
      expect(answers.system).not.toBe("ese-pod");
      expect(answers.system).toBeNull();
      // Nor does it hand the pods on to the next step's link.
      expect(wizardHref(answers)).not.toMatch(/system=ese-pod/);
      expect(wizardHref(answers)).not.toMatch(/illy-x7-ese/);
    },
  );
});

describe("a pod's product page and the illy X7.1", () => {
  it("does not offer the pods for the X7.1", () => {
    const machines = compatibleMachines("ese-pod", 1000);
    expect(machines.total).toBeGreaterThan(0);
    expect(machines.shown).toHaveLength(machines.total);
    for (const machine of machines.shown) {
      expect(machine.name, machine.name).not.toMatch(/x7/i);
    }
  });
});
