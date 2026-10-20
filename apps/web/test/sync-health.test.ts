import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_HEALTH_THRESHOLDS,
  SYNC_CONDITIONS,
  evaluateIdentityChanges,
  evaluateSyncHealth,
  evaluateUnauditedFlavoured,
  unauditedFlavoured,
  type FlavouredProductSnapshot,
  type SyncCondition,
  type SyncRunSnapshot,
  newKeyCollisions,
  unresolvedKeyCollisions,
} from "@/lib/sync-health";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

/** A healthy, finished, real run that started `h` hours ago. */
function run(h: number, over: Partial<SyncRunSnapshot> = {}): SyncRunSnapshot {
  return {
    status: "succeeded",
    dryRun: false,
    startedAt: hoursAgo(h),
    completedAt: hoursAgo(h - 0.1),
    circuitBreakerTripped: false,
    catalogSource: "filter_init",
    parserConfidence: "1.000",
    imagesFailed: 0,
    ...over,
  };
}

const conditions = (runs: SyncRunSnapshot[], now = NOW): SyncCondition[] =>
  evaluateSyncHealth(runs, now).map((f) => f.condition);

describe("evaluateSyncHealth", () => {
  it("reports nothing for a healthy history", () => {
    expect(conditions([run(1), run(7), run(13)])).toEqual([]);
  });

  describe("no_recent_success", () => {
    it("holds for an empty history", () => {
      const findings = evaluateSyncHealth([], NOW);
      expect(findings.map((f) => f.condition)).toEqual(["no_recent_success"]);
      expect(findings[0]?.summary).toMatch(/нито една/);
    });

    it("holds when the last success is older than two intervals plus slack", () => {
      // 6h x 2 + 2h slack = 14h
      expect(conditions([run(14.5)])).toEqual(["no_recent_success"]);
    });

    it("does not hold just inside the window", () => {
      expect(conditions([run(13)])).toEqual([]);
    });

    it("allows one late run: a success 11 hours ago is fine", () => {
      expect(conditions([run(11)])).toEqual([]);
    });

    it("does not count a failed, partial or breaker-tripped run as a success", () => {
      expect(
        conditions([
          run(1, { status: "failed" }),
          run(2, { status: "partial" }),
          run(3, { circuitBreakerTripped: true }),
        ]),
      ).toContain("no_recent_success");
    });

    it("does not count a dry run, however recent", () => {
      expect(conditions([run(1, { dryRun: true }), run(30)])).toEqual(["no_recent_success"]);
    });

    it("does not count a run still in progress", () => {
      expect(conditions([run(0.5, { status: "running", completedAt: null }), run(30)])).toEqual([
        "no_recent_success",
      ]);
    });

    it("measures from completion, falling back to start", () => {
      expect(conditions([run(20, { completedAt: hoursAgo(5) })])).toEqual([]);
      expect(conditions([run(20, { completedAt: null })])).toEqual(["no_recent_success"]);
    });

    it("honours thresholds passed in", () => {
      const tight = { ...DEFAULT_SYNC_HEALTH_THRESHOLDS, slackMs: 0, missedIntervals: 1 };
      expect(evaluateSyncHealth([run(7)], NOW, tight).map((f) => f.condition)).toEqual([
        "no_recent_success",
      ]);
    });
  });

  it("latest_failed: the latest real run failed", () => {
    expect(conditions([run(1, { status: "failed" }), run(5)])).toEqual(["latest_failed"]);
  });

  it("latest_failed: an aborted run counts as failed", () => {
    expect(conditions([run(1, { status: "aborted" }), run(5)])).toEqual(["latest_failed"]);
  });

  it("latest_failed: not raised once a later run succeeded", () => {
    expect(conditions([run(1), run(7, { status: "failed" })])).toEqual([]);
  });

  it("latest_failed: a dry run that failed is not the latest run", () => {
    expect(conditions([run(1, { status: "failed", dryRun: true }), run(2)])).toEqual([]);
  });

  it("latest_partial: the latest real run was partial", () => {
    expect(conditions([run(1, { status: "partial" }), run(7)])).toEqual(["latest_partial"]);
  });

  it("breaker_open: the latest run tripped the breaker", () => {
    expect(conditions([run(1, { circuitBreakerTripped: true }), run(7)])).toEqual(["breaker_open"]);
  });

  it("breaker_open and latest_partial together, as the sync really records a trip", () => {
    expect(
      conditions([run(1, { status: "partial", circuitBreakerTripped: true }), run(7)]),
    ).toEqual(["latest_partial", "breaker_open"]);
  });

  it("source_fallback: catalog_source other than filter_init", () => {
    const findings = evaluateSyncHealth([run(1, { catalogSource: "listing_html" })], NOW);
    expect(findings.map((f) => f.condition)).toEqual(["source_fallback"]);
    expect(findings[0]?.summary).toContain("listing_html");
  });

  it("source_fallback: a run that never got as far as a source is not a fallback", () => {
    expect(conditions([run(1, { catalogSource: null }), run(5)])).toEqual([]);
  });

  it("low_confidence: below the threshold, from the stored text", () => {
    expect(conditions([run(1, { parserConfidence: "0.700" })])).toEqual(["low_confidence"]);
  });

  it("low_confidence: at the threshold is fine; a number works; junk is ignored", () => {
    expect(conditions([run(1, { parserConfidence: "0.900" })])).toEqual([]);
    expect(conditions([run(1, { parserConfidence: 0.5 })])).toEqual(["low_confidence"]);
    expect(conditions([run(1, { parserConfidence: "n/a" })])).toEqual([]);
    expect(conditions([run(1, { parserConfidence: null })])).toEqual([]);
  });

  it("image_failed: any failed image in the latest run", () => {
    const findings = evaluateSyncHealth([run(1, { imagesFailed: 3 })], NOW);
    expect(findings.map((f) => f.condition)).toEqual(["image_failed"]);
    expect(findings[0]?.summary).toContain("3");
  });

  it("only the latest run is judged for its own conditions", () => {
    expect(
      conditions([
        run(1),
        run(7, { imagesFailed: 9, catalogSource: "listing_html", parserConfidence: "0.2" }),
      ]),
    ).toEqual([]);
  });

  it("does not depend on the order rows arrive in", () => {
    const rows = [run(7), run(1, { status: "failed" }), run(13)];
    expect(conditions([...rows].reverse())).toEqual(conditions(rows));
    expect(conditions(rows)).toEqual(["latest_failed"]);
  });

  it("returns each condition once, in a fixed order", () => {
    const found = conditions([
      run(1, {
        status: "partial",
        circuitBreakerTripped: true,
        catalogSource: "listing_html",
        parserConfidence: "0.5",
        imagesFailed: 2,
      }),
      run(40, { status: "failed" }),
    ]);
    expect(found).toEqual([
      "no_recent_success",
      "latest_partial",
      "breaker_open",
      "source_fallback",
      "low_confidence",
      "image_failed",
    ]);
    expect(new Set(found).size).toBe(found.length);
    for (const c of found) expect(SYNC_CONDITIONS).toContain(c);
  });

  it("ignores columns it does not know about", () => {
    const withExtra = { ...run(1), movedCount: 4, somethingNew: "x" } as SyncRunSnapshot;
    expect(conditions([withExtra])).toEqual([]);
  });

  /* Two products the source lists at one address and pack size, as the sync
     records them in `sync_runs.metadata.keyCollisions` (research 08 §1.4). */
  describe("duplicate_key_conflict", () => {
    const PLAIN = "/moreno-super-bar-1/#1000g";
    const collision = (unresolved: string[], sourceKey = PLAIN) => ({
      sourceKey,
      tiebreaker: unresolved.length === 0 ? "name" : null,
      products: [{ sourceKey, name: "Кафе на зърна Moreno Espresso Bar 1кг.", price: "20.00" }],
      dropped: [],
      unresolved,
    });
    const withCollisions = (h: number, keyCollisions: unknown) =>
      run(h, { metadata: { keyCollisions } });
    /** A clean run, as the sync records one: it settled every collision it met. */
    const clean = (h: number) => withCollisions(h, []);

    it("is raised for a collision the sync could not settle, naming the key and the reason", () => {
      const findings = evaluateSyncHealth(
        [withCollisions(1, [collision(["indistinguishable"])])],
        NOW,
      );
      expect(findings.map((f) => f.condition)).toEqual(["duplicate_key_conflict"]);
      expect(findings[0]?.summary).toContain(PLAIN);
      expect(findings[0]?.summary).toContain("различно съдържание");
      expect(SYNC_CONDITIONS).toContain("duplicate_key_conflict");
    });

    it("says what to do: link a rename with --absorb-twin, or leave it to the source", () => {
      const [unmatched] = evaluateSyncHealth([withCollisions(1, [collision(["unmatched"])])], NOW);
      expect(unmatched?.summary).toContain("преименуван или подменен");
      expect(unmatched?.summary).toContain("pnpm catalog:link");
      expect(unmatched?.summary).toContain("--absorb-twin --apply");
      expect(unmatched?.summary).not.toContain("само източникът може да ги раздели");

      const [indistinguishable] = evaluateSyncHealth(
        [withCollisions(1, [collision(["indistinguishable"])])],
        NOW,
      );
      expect(indistinguishable?.summary).toContain("само източникът може да ги раздели");
      expect(indistinguishable?.summary).not.toContain("catalog:link");
    });

    it("is not raised for a collision the sync settled itself: both products kept", () => {
      expect(conditions([withCollisions(1, [collision([])])])).toEqual([]);
    });

    /* H2: four syncs a day, one check. */
    it("reads every run of the last day, not only the latest", () => {
      const day = [clean(1), clean(7), withCollisions(13, [collision(["unmatched"])]), clean(19)];
      expect(conditions(day)).toEqual(["duplicate_key_conflict"]);
      // The run that recorded it, and only it, is named.
      expect(newKeyCollisions(day, NOW)).toEqual([{ sourceKey: PLAIN, unresolved: ["unmatched"] }]);
    });

    it("measures the day from when a run finished, so a run is in exactly one check's day", () => {
      // Started 24.05 h ago, finished 23.95 h ago: today's.
      expect(conditions([clean(1), withCollisions(24.05, [collision(["unmatched"])])])).toEqual([
        "duplicate_key_conflict",
      ]);
      // Finished 24.1 h ago: yesterday's check named it.
      expect(conditions([clean(1), withCollisions(24.2, [collision(["unmatched"])])])).toEqual([]);
    });

    /* L6: what only the source can fix is mailed once, when it appears. */
    it("names a collision once: not again while the source goes on listing it", () => {
      const ongoing = (h: number) => withCollisions(h, [collision(["indistinguishable"])]);
      // It appeared yesterday, and every run since has it: nothing new today.
      expect(conditions([ongoing(1), ongoing(7), ongoing(13), ongoing(19), ongoing(25)])).toEqual(
        [],
      );
      // It appeared today: named.
      expect(conditions([ongoing(1), ongoing(7), clean(13), clean(19)])).toEqual([
        "duplicate_key_conflict",
      ]);
      // It went away and came back: named again.
      expect(conditions([ongoing(1), clean(7), ongoing(25)])).toEqual(["duplicate_key_conflict"]);
    });

    it("tells a new reason at a known key from the old one", () => {
      const runs = [
        withCollisions(1, [collision(["indistinguishable", "unmatched"])]),
        withCollisions(30, [collision(["indistinguishable"])]),
      ];
      expect(newKeyCollisions(runs, NOW)).toEqual([
        { sourceKey: PLAIN, unresolved: ["unmatched"] },
      ]);
    });

    it("compares with the last run that recorded collisions, past a run that failed first", () => {
      const ongoing = (h: number) => withCollisions(h, [collision(["indistinguishable"])]);
      const failed = run(7, { status: "failed", metadata: {} });
      expect(conditions([ongoing(1), failed, ongoing(30)])).toEqual([]);
      // The first run that ever recorded collisions has nothing before it: new.
      expect(conditions([ongoing(1), run(30)])).toEqual(["duplicate_key_conflict"]);
    });

    it("ignores a dry run, however recent", () => {
      const dry = { ...withCollisions(0.5, [collision(["unmatched"])]), dryRun: true };
      expect(conditions([dry, run(1)])).toEqual([]);
    });

    it("names five and counts the rest; reads only well-formed entries", () => {
      const many = Array.from({ length: 7 }, (_, i) =>
        collision(["indistinguishable"], `/p-${i}/#1000g`),
      );
      const [finding] = evaluateSyncHealth(
        [withCollisions(1, [...many, null, "junk", { sourceKey: 4, unresolved: ["x"] }])],
        NOW,
      );
      expect(finding?.summary).toContain("/p-4/#1000g");
      expect(finding?.summary).not.toContain("/p-5/#1000g");
      expect(finding?.summary).toContain("и още 2");
    });

    it("says nothing for a run recorded before collisions were, or with junk in their place", () => {
      expect(conditions([run(1, { metadata: {} })])).toEqual([]);
      expect(conditions([run(1, { metadata: null })])).toEqual([]);
      expect(conditions([withCollisions(1, "not a list")])).toEqual([]);
      expect(
        conditions([withCollisions(1, [{ sourceKey: PLAIN, unresolved: [1, null] }])]),
      ).toEqual([]);
    });

    it("takes its place in the fixed order, after the image check", () => {
      expect(
        conditions([{ ...withCollisions(1, [collision(["unmatched"])]), imagesFailed: 1 }]),
      ).toEqual(["image_failed", "duplicate_key_conflict"]);
    });

    it("raises a row the sync would not move from a shared address on a code alone (M2)", () => {
      const refused = (h: number, reason = "shared_address") =>
        run(h, {
          metadata: {
            keyCollisions: [],
            unresolvedMoves: [
              {
                matchedBy: "sku",
                reason,
                fingerprint: "sku 00417",
                existingKeys: [PLAIN],
                discoveredKeys: ["/moreno-espresso-bar-1/#1000g"],
              },
            ],
          },
        });
      const [finding] = evaluateSyncHealth([refused(1)], NOW);
      expect(finding?.condition).toBe("duplicate_key_conflict");
      expect(finding?.summary).toContain(PLAIN);
      expect(finding?.summary).toContain("преместен и преименуван");
      expect(finding?.summary).toContain("--absorb-twin --apply");
      // Other unresolved moves are not this condition's to raise.
      expect(conditions([refused(1, "tie")])).toEqual([]);
      // And, like a collision, it is named once, not on every run after.
      expect(conditions([refused(1), refused(7), refused(30)])).toEqual([]);
    });

    it("gives one piece of advice for two reasons that share it", () => {
      const [finding] = evaluateSyncHealth(
        [
          run(1, {
            metadata: {
              keyCollisions: [collision(["unmatched"])],
              unresolvedMoves: [{ reason: "shared_address", existingKeys: ["/x/#1000g"] }],
            },
          }),
        ],
        NOW,
      );
      expect(finding?.summary.split("pnpm catalog:link")).toHaveLength(2);
    });

    it("is pure: unresolvedKeyCollisions reads one run", () => {
      expect(
        unresolvedKeyCollisions(
          withCollisions(1, [collision([]), collision(["unmatched"], "/x/#1000g")]),
        ),
      ).toEqual([{ sourceKey: "/x/#1000g", unresolved: ["unmatched"] }]);
    });
  });
});

/* A row whose source address another product takes over gets that one's
   name and price as an ordinary update (research 08 §1.4). Every rename is
   named for a person. */
describe("evaluateIdentityChanges", () => {
  const change = (
    before: string | null,
    after: string | null,
    prices: [string, string] = ["20.00", "20.00"],
  ) => ({
    sourceKey: "/moreno-super-bar-1/::1kg",
    before: before === null ? null : { name: before, currentPrice: prices[0] },
    after: after === null ? null : { name: after, currentPrice: prices[1] },
  });

  it("names a product the sync renamed, with the price when it moved too", () => {
    const finding = evaluateIdentityChanges([
      change("Moreno Espresso Bar 1 кг", "Moreno Super Bar 1 кг", ["20.00", "25.00"]),
    ]);
    expect(finding?.condition).toBe("identity_changed");
    expect(finding?.summary).toContain(
      "„Moreno Espresso Bar 1 кг“ → „Moreno Super Bar 1 кг“ (цена 20.00 → 25.00)",
    );
    expect(SYNC_CONDITIONS).toContain("identity_changed");
  });

  it("is nothing when no name changed, or a side is missing", () => {
    expect(evaluateIdentityChanges([])).toBeNull();
    expect(evaluateIdentityChanges([change("A", "A", ["1.00", "2.00"])])).toBeNull();
    expect(evaluateIdentityChanges([change(null, "A"), change("A", null)])).toBeNull();
    expect(evaluateIdentityChanges([change(" A ", "A")])).toBeNull();
  });

  it("says when the read stopped at its limit, so the count is a floor", () => {
    const many = Array.from({ length: 7 }, (_, i) => change(`A${i}`, `B${i}`));
    expect(evaluateIdentityChanges(many, { more: true })!.summary).toContain("и още поне 2");
    expect(evaluateIdentityChanges(many.slice(0, 2), { more: true })!.summary).toContain(
      "и може би още",
    );
  });

  it("names five and counts the rest", () => {
    const many = Array.from({ length: 7 }, (_, i) => change(`A${i}`, `B${i}`));
    const summary = evaluateIdentityChanges(many)!.summary;
    expect(summary).toContain("„A4“ → „B4“");
    expect(summary).not.toContain("„A5“");
    expect(summary).toContain("и още 2");
  });
});

/* The flavoured page lists only audited coffees (`content/no-coffee.ts`); a
   flagged product nobody has classified is held back and raised for review. */
describe("evaluateUnauditedFlavoured", () => {
  const product = (
    slug: string,
    descriptions: readonly string[] = [],
    previousSlugs: readonly string[] = [],
  ): FlavouredProductSnapshot => ({
    slug,
    previousSlugs,
    name: `Продукт ${slug}`,
    descriptions,
  });

  it("raises only what neither list holds: an audited coffee is never raised, whatever it says", () => {
    const held = unauditedFlavoured([
      // An audited coffee whose words could be read as none.
      product("bianchi-hazelnut-aroma-espresso-kapsuli-dolce-gusto-16-br", [
        "Не можете без кафе сутрин? Еспресо с лешник.",
      ]),
      product("rema-caffe-matcha-kapsuli-dolce-gusto-16-br"),
      // Audited under the slug it had before.
      product(
        "rema-caffe-krem-bryule-16",
        [],
        ["rema-caffe-creme-brulee-kapsuli-dolce-gusto-16-br"],
      ),
      product("new-hot-chocolate-hazelnut-16", ["<p>Горещ шоколад с аромат на лешник.</p>"]),
    ]);
    expect(held.map((entry) => entry.slug)).toEqual(["new-hot-chocolate-hazelnut-16"]);
  });

  it("names each with its slug and what its description suggests, and says where to file it", () => {
    const finding = evaluateUnauditedFlavoured([
      product("new-chai-latte-16", ["Чай лате без&nbsp;кафе."]),
    ]);
    expect(finding?.condition).toBe("flavoured_unaudited");
    expect(finding?.summary).toContain(
      "„Продукт new-chai-latte-16“ (new-chai-latte-16) — описанието казва „без кафе“",
    );
    expect(finding?.summary).toMatch(/^Ароматизиран продукт, за който още не е проверено/);
    expect(finding?.summary).toContain("не се показва на страницата „Ароматизирано кафе“");
    expect(finding?.summary).toContain("apps/web/content/no-coffee.ts");
    expect(finding?.summary).toContain("FLAVOURED_COFFEE");
    expect(finding?.summary).toContain("NO_COFFEE");
    expect(SYNC_CONDITIONS).toContain("flavoured_unaudited");
  });

  it("gives no hint where the description suggests nothing, and decaf suggests nothing", () => {
    const summary = evaluateUnauditedFlavoured([
      product("new-decaf-vanilla-16", ["Безкофеиново кафе с аромат на ванилия, без кофеин."]),
    ])!.summary;
    expect(summary).toContain("(new-decaf-vanilla-16).");
    expect(summary).not.toContain("описанието казва");
  });

  it("speaks of several in the plural, names ten, counts the rest and the ones still waiting", () => {
    const many = Array.from({ length: 12 }, (_, i) => product(`new-flavoured-${i}`));
    const summary = evaluateUnauditedFlavoured(many, { alreadyRaised: 2 })!.summary;
    expect(summary).toMatch(/^Ароматизирани продукти, за които още не е проверено/);
    expect(summary).toContain("(new-flavoured-9)");
    expect(summary).not.toContain("(new-flavoured-10)");
    expect(summary).toContain("и още 2.");
    expect(summary).toContain("Още 2 от предишно известие също чакат проверка.");
  });

  it("is nothing when nothing is held back", () => {
    expect(evaluateUnauditedFlavoured([])).toBeNull();
  });
});
