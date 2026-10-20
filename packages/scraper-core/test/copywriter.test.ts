import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_INTERNAL_RUN_WORDS, longestSharedRun, normalizeForComparison } from "@catalog/shared";
import { COMPATIBILITY_WORDING, compatibilityProblems } from "@catalog/shared/compatibility-copy";
import {
  type ReviewContext,
  correctionHeldBack,
  differsFromStored,
  independentHosts,
  paragraphsToHtml,
  reviewBatch,
  siteOf,
} from "../src/catalog/copywriter/apply.ts";
import { auditGeneratedCopy, statedPackSizes } from "../src/catalog/copywriter/audit.ts";
import {
  ClaudeRunError,
  childEnvironment,
  claudeArgs,
  classifyFailure,
  parseClaudeEnvelope,
} from "../src/catalog/copywriter/claude.ts";
import {
  COPY_OUTPUT_JSON_SCHEMA,
  type CopyResearch,
  type CopyWorkItem,
  LIMITS,
  copyOutputSchema,
} from "../src/catalog/copywriter/contract.ts";
import { MAX_RESEARCH_PER_BATCH, scrubForLog, toBatches } from "../src/catalog/copywriter/run.ts";
import {
  type CopyCandidate,
  MAX_COPY_ATTEMPTS,
  copySourceHash,
  readStoredResearch,
  researchBasis,
  researchReasons,
  selectCopyWork,
} from "../src/catalog/copywriter/select.ts";
import { createSourceCheck, printsNumber } from "../src/catalog/copywriter/verify.ts";

/* --- Fixtures ------------------------------------------------------------- */

let sequence = 0;

function candidate(overrides: Partial<CopyCandidate> = {}): CopyCandidate {
  sequence += 1;
  return {
    id: `id-${sequence}`,
    slug: `product-${sequence}`,
    status: "active",
    name: `Lavazza Crema e Aroma ${sequence} 1кг.`,
    sourceKey: `/product-${sequence}/`,
    brandName: "Lavazza",
    brandSourceKey: "lavazza",
    categoryKeys: ["kafe-na-zarna"],
    descriptionText:
      "Lavazza Crema e Aroma is a rich blend of arabica and robusta with notes of chocolate.",
    summary: null,
    bodyParagraphs: [],
    weightValue: "1000.0000",
    weightUnit: "g",
    price: "20.00",
    arabicaPercent: 60,
    origin: null,
    roast: null,
    attributes: {},
    characteristics: [],
    sourceData: {},
    copyOrigin: null,
    copySourceHash: null,
    copyAttempts: 0,
    packOverrideValue: null,
    research: null,
    lastChangedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

function workItem(overrides: Partial<CopyWorkItem> = {}): CopyWorkItem {
  return {
    id: "id-x",
    slug: "product-x",
    title: "Lavazza Crema e Aroma",
    brand: "Lavazza",
    format: "Кафе на зърна",
    kind: "roasted",
    pack: { label: "1 кг", inName: null, inPackField: null, mayState: true },
    priceEur: "20.00",
    facts: { arabicaPercent: 60, origin: null, roast: null, attributes: {}, characteristics: [] },
    sourceDescription:
      "Lavazza Crema e Aroma is a rich blend of arabica and robusta with notes of chocolate.",
    siblingSummaries: [],
    task: { writeCopy: true, research: false, researchReasons: [] },
    ...overrides,
  };
}

const GOOD_COPY = {
  summary:
    "Италиански бленд с 60 % арабика — кадифено тяло, гъста крема и шоколадов оттенък в чашата.",
  body: [
    "Съставът съчетава арабика с робуста: първата носи аромата, втората плътността и кремата.",
    "Килограмовата опаковка е удобна за офис или за дом с автоматична кафемашина, където се пият по няколко чаши на ден.",
  ],
};

const HIGH_CORRECTION: CopyResearch = {
  verdict: "corrected",
  pack: {
    value: 20,
    unit: "pc",
    confidence: "high",
    sources: ["https://www.illy.com/tin-20", "https://shop.example.de/illy-20"],
  },
  findings: [],
  note: "The manufacturer and a German shop both list 20 pods.",
};

type Pack = NonNullable<CopyResearch["pack"]>;
const HIGH_PACK = HIGH_CORRECTION.pack as Pack;
const withPack = (pack: Partial<Pack>, research: Partial<CopyResearch> = {}): CopyResearch => ({
  ...HIGH_CORRECTION,
  ...research,
  pack: { ...HIGH_PACK, ...pack },
});

const withBody = (...extra: string[]) => ({ ...GOOD_COPY, body: [...GOOD_COPY.body, ...extra] });

const pass = async () => null;

/* --- The model call --------------------------------------------------------- */

describe("claude CLI arguments", () => {
  const args = claudeArgs("batch-1.json", { model: "claude-opus-5-5", maxTurns: 80 });
  const value = (flag: string) => args[args.indexOf(flag) + 1];

  it("invokes the skill on the batch file", () => {
    expect(value("-p")).toBe("/catalog-copy batch-1.json");
  });

  it("passes the output contract as one JSON argument", () => {
    expect(JSON.parse(value("--json-schema") as string)).toEqual(COPY_OUTPUT_JSON_SCHEMA);
  });

  it("allows reading the workspace and the web, and nothing that runs or writes", () => {
    expect(value("--tools")).toBe("Read,WebSearch,WebFetch");
    expect(value("--allowedTools")).toBe("Read(./**),WebSearch,WebFetch");
    expect(args.join(" ")).not.toMatch(/Bash|Edit|Write|bypassPermissions/);
    expect(args).toContain("--strict-mcp-config");
    expect(value("--permission-mode")).toBe("dontAsk");
    expect(value("--permission-prompts")).toBe("none");
  });

  it("hands the CLI none of this process's secrets", () => {
    const env = childEnvironment({
      PATH: "/usr/bin",
      Path: "C:\\Windows",
      HOME: "/home/runner",
      SystemRoot: "C:\\Windows",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
      ANTHROPIC_API_KEY: "",
      DATABASE_URL: "postgres://user:secret@host/db",
      BLOB_READ_WRITE_TOKEN: "blob",
      GITHUB_TOKEN: "gh",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      Path: "C:\\Windows",
      HOME: "/home/runner",
      SystemRoot: "C:\\Windows",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
    });
  });

  it("strips the line breaks a token picks up when copied out of a terminal", () => {
    const env = childEnvironment({
      CLAUDE_CODE_OAUTH_TOKEN: " sk-ant-oat01-abc\n  def\r\nghi \n",
    });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-abcdefghi");
  });
});

describe("parseClaudeEnvelope", () => {
  it("returns the structured output, cost and turns", () => {
    const parsed = parseClaudeEnvelope(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "done",
        structured_output: { products: [] },
        total_cost_usd: 0.42,
        num_turns: 7,
      }),
    );
    expect(parsed).toEqual({ output: { products: [] }, costUsd: 0.42, turns: 7 });
  });

  it("classifies running out of turns as the batch's failure", () => {
    try {
      parseClaudeEnvelope(
        JSON.stringify({ subtype: "error_max_turns", is_error: true, result: "usage limit" }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ClaudeRunError);
      expect((error as ClaudeRunError).failure).toBe("batch");
    }
  });

  it("classifies by what the CLI says, not by any number on a page", () => {
    expect(classifyFailure("Invalid API key · Please run /login")).toBe("setup");
    expect(classifyFailure("API Error: 401 authentication_error")).toBe("setup");
    expect(classifyFailure("Claude AI usage limit reached|1760000000")).toBe("service");
    expect(classifyFailure("API Error: 529 Overloaded")).toBe("service");
    expect(classifyFailure("API Error: 500 Internal server error")).toBe("service");
    expect(classifyFailure("Connection error.")).toBe("service");
    // A web page's 403, or "catalog in" in prose, is nobody's sign-in problem.
    expect(classifyFailure("WebFetch returned 403 for the shop's page")).toBe("batch");
    expect(classifyFailure("added the item to the catalog in stock")).toBe("batch");
    expect(classifyFailure("The model returned something odd")).toBe("batch");
  });

  it("rejects output without structured data", () => {
    expect(() => parseClaudeEnvelope("not json")).toThrow(ClaudeRunError);
    expect(() => parseClaudeEnvelope(JSON.stringify({ subtype: "success", result: "hi" }))).toThrow(
      /no structured output/,
    );
  });
});

describe("output contract", () => {
  it("the JSON schema and the zod schema describe the same object", () => {
    const sample = {
      products: [
        { id: "a", copy: GOOD_COPY, research: null },
        { id: "b", copy: null, research: HIGH_CORRECTION },
      ],
    };
    expect(copyOutputSchema.safeParse(sample).success).toBe(true);
    const item = COPY_OUTPUT_JSON_SCHEMA.properties.products.items;
    expect([...item.required].sort()).toEqual(["copy", "id", "research"]);
    const research = item.properties.research.anyOf[1];
    expect([...research.required].sort()).toEqual(Object.keys(HIGH_CORRECTION).sort());
    expect(research.properties.note.maxLength).toBe(LIMITS.note);
    expect(research.properties.findings.items.properties.found.maxLength).toBe(LIMITS.value);
  });

  it("trims an over-long finding and drops a source that is not an address", () => {
    const parsed = copyOutputSchema.parse({
      products: [
        {
          id: "a",
          copy: null,
          research: {
            ...HIGH_CORRECTION,
            findings: [
              {
                field: "ingredients",
                ours: null,
                found: "x".repeat(500),
                confidence: "high",
                sources: ["Open Food Facts EAN 8000070", "https://world.openfoodfacts.org/p/1"],
              },
            ],
          },
        },
      ],
    });
    const finding = parsed.products[0]?.research?.findings[0];
    expect(finding?.found).toHaveLength(LIMITS.value);
    expect(finding?.sources).toEqual(["https://world.openfoodfacts.org/p/1"]);
  });
});

/* --- Selection -------------------------------------------------------------- */

describe("selectCopyWork", () => {
  it("writes copy for a product with none, never over a person's", () => {
    const fresh = candidate();
    const hand = candidate({ copyOrigin: "hand", summary: "Ръчно написан текст за продукта." });
    const edited = candidate({ copyOrigin: "edited", summary: "Поправен текст." });
    // An override of unknown origin - only a body, say - is a person's too.
    const unknown = candidate({ bodyParagraphs: ["Абзац, написан отнякого."] });
    const plan = selectCopyWork([fresh, hand, edited, unknown], { limit: 10 });
    expect(plan.items.map((item) => item.slug)).toEqual([fresh.slug]);
    // Not even when asked by name with --force.
    const forced = selectCopyWork([hand], { limit: 10, slugs: [hand.slug], force: true });
    expect(forced.items).toHaveLength(0);
  });

  it("rewrites machine copy only when its facts changed", () => {
    const current = candidate({ copyOrigin: "ai", summary: "Текст." });
    const upToDate = { ...current, copySourceHash: copySourceHash(current) };
    const stale = { ...current, id: "stale", slug: "stale", copySourceHash: "old" };
    const plan = selectCopyWork([upToDate, stale], { limit: 10 });
    expect(plan.items.map((item) => item.slug)).toEqual(["stale"]);
  });

  it("does not see a stored 18.0000 and a written 18 as different facts", () => {
    const stored = candidate({ weightValue: "18.0000", weightUnit: "pc" });
    expect(copySourceHash(stored)).toBe(copySourceHash({ ...stored, weightValue: "18" }));
  });

  it("researches a product whose name and pack field disagree, first", () => {
    const plain = candidate({ lastChangedAt: new Date("2026-10-10T00:00:00Z") });
    const tin = candidate({
      weightValue: "18.0000",
      weightUnit: "pc",
      sourceData: { packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." } },
    });
    const plan = selectCopyWork([plain, tin], { limit: 10 });
    expect(plan.items[0]?.slug).toBe(tin.slug);
    expect(plan.items[0]?.task.research).toBe(true);
    expect(plan.items[0]?.task.researchReasons[0]).toMatch(/18 бр\..*100 бр\./);
    expect(plan.items[0]?.pack).toMatchObject({
      label: "18 бр.",
      inName: "18 бр.",
      inPackField: "100 бр.",
      mayState: true,
    });
  });

  it("researches again only when the supplier's pack statements change", () => {
    const tin = candidate({
      sourceData: {
        packField: "100 бр.",
        weightCanonical: "18pc",
        packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
      },
    });
    const checked = {
      ...tin,
      research: { basis: researchBasis(tin), heldBack: null, applied: true, rejected: [] },
    };
    // Not on a price change, nor on a description change, nor on our own correction.
    expect(researchReasons({ ...checked, price: "25.00" }, new Map())).toEqual([]);
    expect(researchReasons({ ...checked, descriptionText: "New text." }, new Map())).toEqual([]);
    expect(
      researchReasons({ ...checked, weightValue: "20", packOverrideValue: "20" }, new Map()),
    ).toEqual([]);
    // The supplier repackages: check again, and say why.
    const repackaged = {
      ...checked,
      packOverrideValue: "20",
      sourceData: { packField: "16 бр.", weightCanonical: "16pc" },
    };
    expect(researchReasons(repackaged, new Map())).toEqual([
      "доставчикът промени данните за опаковката, откакто размерът ни беше поправен",
    ]);
  });

  it("forbids stating the size while an earlier check left it unsettled", () => {
    const disputed = candidate({
      research: { basis: "old", heldBack: "увереността е средна", applied: false, rejected: [] },
    });
    const plan = selectCopyWork([disputed], { limit: 10 });
    expect(plan.items[0]?.pack.mayState).toBe(false);
  });

  it("flags a price per cup far from its format's", () => {
    const normal = Array.from({ length: 6 }, () => candidate({ price: "20.00" }));
    // Same 1 kg pack at a twentieth of the price: a misread size, not a bargain.
    const odd = candidate({ price: "1.00" });
    const plan = selectCopyWork([...normal, odd], { limit: 20 });
    const item = plan.items.find((entry) => entry.slug === odd.slug);
    expect(item?.task.research).toBe(true);
    expect(item?.task.researchReasons.join(" ")).toMatch(/ под /);
  });

  it("gives up after repeated failures, and honours the limit", () => {
    const failing = candidate({ copyAttempts: MAX_COPY_ATTEMPTS });
    const others = Array.from({ length: 5 }, () => candidate());
    const plan = selectCopyWork([failing, ...others], { limit: 3 });
    expect(plan.givenUp).toEqual([failing.slug]);
    expect(plan.items).toHaveLength(3);
    expect(plan.deferred).toBe(2);
  });

  it("shows the model its siblings' summaries, not its own", () => {
    const own = candidate({ copyOrigin: "ai", summary: "Собственият текст.", copySourceHash: "x" });
    const sibling = candidate({ copyOrigin: "hand", summary: "Текстът на съседа." });
    const plan = selectCopyWork([own, sibling], { limit: 10 });
    expect(plan.items[0]?.siblingSummaries).toEqual(["Текстът на съседа."]);
  });

  it("reads a stored check defensively, treating an old version as unchecked", () => {
    expect(readStoredResearch({ version: 1, basis: "x", applied: true })).toMatchObject({
      basis: null,
      applied: true,
    });
    expect(
      readStoredResearch({
        version: 2,
        basis: "x",
        heldBack: "confidence is low",
        rejected: [{ value: 20, unit: "pc" }, { value: "junk" }],
      }),
    ).toEqual({
      basis: "x",
      heldBack: "confidence is low",
      applied: false,
      rejected: [{ value: 20, unit: "pc" }],
    });
  });
});

/* --- The audit ---------------------------------------------------------------- */

describe("auditGeneratedCopy", () => {
  const audit = (
    copy = GOOD_COPY,
    item = workItem(),
    context: Partial<{ summaries: Map<string, string>; bodies: Map<string, string[]> }> = {},
  ) =>
    auditGeneratedCopy(item, copy, item.pack, {
      summaries: context.summaries ?? new Map(),
      bodies: context.bodies ?? new Map(),
    });

  it("passes original Bulgarian copy", () => {
    expect(audit()).toEqual({ ok: true, problems: [] });
  });

  it("rejects the source's own words", () => {
    const item = workItem({
      sourceDescription:
        "Кафе с богат вкус и плътна крема, подходящо за еспресо машини и автоматични кафемашини у дома, в офиса и в малки заведения с ежедневна консумация.",
    });
    const copy = {
      summary: "Кафе с богат вкус и плътна крема, подходящо за еспресо машини у дома и в офиса.",
      body: GOOD_COPY.body,
    };
    const result = audit(copy, item);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/поредни думи|изразите на източника/);
  });

  it("does not count naming the product as copying a short source", () => {
    const item = workItem({
      title: "Lavazza Crema e Aroma Espresso Bar Edition",
      sourceDescription: "Lavazza Crema e Aroma Espresso Bar Edition 1 кг.",
    });
    const copy = {
      ...GOOD_COPY,
      summary:
        "Lavazza Crema e Aroma Espresso Bar Edition е бленд с кадифено тяло и гъста крема в чашата.",
    };
    expect(audit(copy, item).problems).not.toContainEqual(expect.stringMatching(/source/));
  });

  it("rejects prices in Bulgarian, where \\b would not see them", () => {
    expect(audit(withBody("Струва под 40 лв. на килограм, а това е изгодно.")).problems).toContain(
      "текстът споменава цена или валута",
    );
    expect(audit(withBody("Цената е около 20 евро за килограм кафе.")).problems).toContain(
      "текстът споменава цена или валута",
    );
  });

  it("rejects naming the source shop or a web address, but not an ordinary phrase", () => {
    expect(audit(withBody("Предлага се и в КафеЗона, както и на сайта ни.")).problems).toContain(
      "текстът назовава магазина източник",
    );
    expect(
      audit(withBody("Повече за кафето ще намерите на lavazza.com в раздела.")).problems,
    ).toContain("текстът съдържа уеб адрес");
    expect(audit(withBody("Подходящо за малка кафе зона в офиса, до хладилника.")).ok).toBe(true);
  });

  it("rejects a pack size other than the product's, but not a dose", () => {
    expect(audit(withBody("Опаковка 500 г цели зърна за дома.")).problems.join(" ")).toMatch(
      /посочва опаковка от 500 г/,
    );
    expect(audit(withBody("За една чаша еспресо са нужни около 7 г смляно кафе.")).ok).toBe(true);
    expect(audit(withBody("Опаковка от 1 кг, или 1 000 грама цели зърна.")).ok).toBe(true);
  });

  it("accepts parts of the pack beside the pack itself", () => {
    const item = workItem({
      pack: { label: "16 бр.", inName: null, inPackField: null, mayState: true },
    });
    const copy = withBody("В кутията има 16 капсули: 8 капсули кафе и 8 капсули мляко за лате.");
    expect(audit(copy, item).ok).toBe(true);
  });

  it("states no size at all while the size is disputed", () => {
    const item = workItem({
      pack: { label: "1 кг", inName: null, inPackField: null, mayState: false },
    });
    expect(audit(withBody("Опаковка от 1 кг цели зърна за дома."), item).problems).toContain(
      "посочва размер на опаковката, докато размерът е спорен",
    );
    expect(audit(GOOD_COPY, item).ok).toBe(true);
  });

  it("rejects another product's summary, not the product's own", () => {
    const worn = (by: string) => new Map([[normalizeForComparison(GOOD_COPY.summary), by]]);
    expect(audit(GOOD_COPY, workItem(), { summaries: worn("other") }).problems).toContain(
      "краткото описание е същото като на друг продукт",
    );
    expect(audit(GOOD_COPY, workItem(), { summaries: worn("id-x") }).ok).toBe(true);
  });

  it("rejects a paragraph that repeats another product's", () => {
    const bodies = new Map([["other", [GOOD_COPY.body[1] as string]]]);
    expect(audit(GOOD_COPY, workItem(), { bodies }).problems.join(" ")).toMatch(
      /абзац 2 повтаря \d+ поредни думи от описанието на друг продукт/,
    );
    const own = new Map([["id-x", [...GOOD_COPY.body]]]);
    expect(audit(GOOD_COPY, workItem(), { bodies: own }).ok).toBe(true);
  });

  it("rejects a compatibility promise the machine's maker contradicts, and says what to write", () => {
    const capsules = workItem({
      title: "Rema Caffè Espresso",
      format: "Капсули за Dolce Gusto",
      pack: { label: "16 бр.", inName: null, inPackField: null, mayState: true },
    });
    const loose = audit(
      withBody("16 капсули, съвместими с машини Dolce Gusto, по една на чаша."),
      capsules,
    );
    expect(loose.ok).toBe(false);
    expect(loose.problems).toEqual([
      expect.stringMatching(
        /^съвместимост: „машини Dolce Gusto“ включва и машините Dolce Gusto NEO.*„съвместими с класическите машини Dolce Gusto \(не NEO\)“$/,
      ),
    ]);
    expect(
      audit(
        withBody(`16 капсули, ${COMPATIBILITY_WORDING.dolceGusto}, по една на чаша.`),
        capsules,
      ),
    ).toEqual({ ok: true, problems: [] });
    // Naming the format is what the product is, not a promise about machines.
    expect(
      audit(withBody("Капсули за Dolce Gusto с плътно тяло и гъста крема."), capsules).ok,
    ).toBe(true);

    const nespresso = workItem({ format: "Капсули за Nespresso" });
    expect(
      audit(withBody("Подходящи за домашните машини Nespresso и за офиса."), nespresso).problems,
    ).toContainEqual(expect.stringMatching(/^съвместимост: „домашните машини Nespresso“.*Vertuo/));
    expect(
      audit(withBody("Подходящи за машини Nespresso Original, не с Vertuo."), nespresso).ok,
    ).toBe(true);

    const caffitaly = workItem({ format: "Капсули за Caffitaly" });
    expect(
      audit(withBody("Формата приемат и машините K-fee, и Tchibo Cafissimo."), caffitaly).problems,
    ).toEqual([
      expect.stringMatching(/^съвместимост: „K-fee“.*отделна система/),
      expect.stringMatching(/^съвместимост: „Cafissimo“.*само нейните капсули/),
    ]);
    expect(
      audit(
        withBody(
          "Формата приемат и машините Tchibo Cafissimo, но Tchibo препоръчва в тях само собствените си капсули.",
        ),
        caffitaly,
      ).ok,
    ).toBe(true);
  });

  it("lets a Caffitaly text in the skill's own words through both rules", () => {
    // The six hand-written Caffitaly entries end in the same fixed caveat; a
    // seventh product written as the skill asks must not „repeat“ them.
    const caveat = `${COMPATIBILITY_WORDING.cafissimo}.`;
    const published = [
      `Кутия от 10 капсули за машини Caffitaly. Същия формат приемат и машините Tchibo Cafissimo. ${caveat}`,
      `10 капсули, съвместими с машини Caffitaly. Същия формат приемат и машините Tchibo Cafissimo. ${caveat}`,
      `10 капсули за машини Caffitaly; форматът става и за Tchibo Cafissimo. ${caveat}`,
    ];
    const ours = `10 капсули за машини Caffitaly. Същия формат приемат и машините Tchibo Cafissimo. ${caveat}`;
    const longest = Math.max(...published.map((other) => longestSharedRun(other, ours)));
    expect(longest).toBeGreaterThan(MAX_INTERNAL_RUN_WORDS);

    const item = workItem({
      title: "Caffitaly Espresso Delicato",
      brand: "Caffitaly",
      format: "Капсули за Caffitaly",
      pack: { label: "10 бр.", inName: null, inPackField: null, mayState: true },
    });
    const copy = withBody(ours);
    expect(compatibilityProblems([copy.summary, ...copy.body])).toEqual([]);
    const bodies = new Map(published.map((paragraph, index) => [`hand-${index}`, [paragraph]]));
    expect(audit(copy, item, { bodies })).toEqual({ ok: true, problems: [] });

    // Phrasing of its own beside the fixed sentence is still held to the limit.
    const own =
      "Вкусът е мек и балансиран, с нотки на какао и печени ядки, а послевкусът остава дълъг и сладък.";
    const repeated = new Map([["hand-0", [`${own} ${caveat}`]]]);
    expect(audit(withBody(`${own} ${caveat}`), item, { bodies: repeated }).problems).toEqual([
      expect.stringMatching(/^абзац 3 повтаря \d+ поредни думи от описанието на друг продукт$/),
    ]);
  });

  it("names each broken rule once, however many sentences break it", () => {
    const copy = withBody(
      "Съвместими с машини Dolce Gusto на Krups.",
      "Подходящи за всички машини Dolce Gusto у дома.",
    );
    const problems = audit(copy).problems.filter((problem) => problem.startsWith("съвместимост"));
    expect(problems).toHaveLength(1);
  });

  it("reads pack sizes in the forms copy writes them", () => {
    expect(
      statedPackSizes(
        "16 капсули, 1 кг, 250 г, 10 бр., 500 грама, 1 килограм, 16 броя, 1 литър, 1 000 г, 1,5 кг",
      ),
    ).toEqual([
      { value: "16", unit: "pc" },
      { value: "1000", unit: "g" },
      { value: "250", unit: "g" },
      { value: "10", unit: "pc" },
      { value: "500", unit: "g" },
      { value: "1000", unit: "g" },
      { value: "16", unit: "pc" },
      { value: "1000", unit: "ml" },
      { value: "1000", unit: "g" },
      { value: "1500", unit: "g" },
    ]);
  });
});

/* --- Judging an answer -------------------------------------------------------- */

describe("correctionHeldBack", () => {
  const current = { value: "100.0000", unit: "pc" };

  it("lets a confident, independently sourced, plausible correction through", () => {
    expect(correctionHeldBack(HIGH_CORRECTION, current)).toBeNull();
  });

  it("holds back anything less", () => {
    expect(correctionHeldBack(withPack({ confidence: "medium" }), current)).toMatch(/увереността/);
    const supplierOnly = withPack({
      sources: ["https://kafezona.com/illy", "https://www.illy.com/tin-20", "https://illy.com/x"],
    });
    expect(correctionHeldBack(supplierOnly, current)).toMatch(/1 независим източник/);
    expect(correctionHeldBack(withPack({ value: 5000 }), current)).toMatch(/правдоподобна/);
    expect(correctionHeldBack(withPack({ value: 2 }), current)).toMatch(/пъти/);
    expect(correctionHeldBack(withPack({}, { verdict: "inconclusive" }), current)).toMatch(
      /неубедителна/,
    );
  });

  it("leaves a change of unit, or a first size, to a person", () => {
    // A 250 g bag "corrected" to 1 piece would make the whole bag one cup.
    expect(correctionHeldBack(withPack({ value: 1 }), { value: "250", unit: "g" })).toMatch(
      /мерната единица/,
    );
    expect(correctionHeldBack(HIGH_CORRECTION, { value: null, unit: null })).toMatch(
      /потвърждава от човек/,
    );
  });

  it("never applies a size the owner turned down", () => {
    expect(correctionHeldBack(HIGH_CORRECTION, current, [{ value: 20, unit: "pc" }])).toMatch(
      /собственикът избра/,
    );
  });

  it("compares the size found with the stored one, rounded as it will be stored", () => {
    expect(differsFromStored(HIGH_PACK, { value: "20.0000", unit: "pc" })).toBe(false);
    expect(differsFromStored(HIGH_PACK, { value: "100.0000", unit: "pc" })).toBe(true);
    expect(differsFromStored(HIGH_PACK, { value: "20", unit: "g" })).toBe(true);
    expect(differsFromStored(HIGH_PACK, { value: null, unit: null })).toBe(true);
    const ounces = { ...HIGH_PACK, value: 340.1942775, unit: "g" as const };
    expect(differsFromStored(ounces, { value: "340.0000", unit: "g" })).toBe(false);
  });

  it("counts sites, not URLs, and none that are the supplier, us, or anyone's content", () => {
    expect(
      independentHosts([
        "https://www.illy.com/a",
        "https://shop.illy.com/b",
        "https://kafezona.com./c",
        "https://web.archive.org/web/2026/https://kafezona.com/x",
        "https://web.archive.org/web/2026/https://example.org/x",
        "https://buy-a-coffee.com/d",
        "https://a.blogspot.com/e",
        "https://b.blogspot.com/f",
        "https://www.coffee.co.uk/g",
        "not a url",
      ]),
    ).toEqual(["illy.com", "coffee.co.uk"]);
    expect(siteOf("www.shop.example.de.")).toBe("example.de");
  });
});

describe("source check", () => {
  const page = (body: string, status = 200) => new Response(body, { status });

  it("needs two sites that open and print the figure", async () => {
    const pages: Record<string, () => Response> = {
      "https://www.illy.com/tin-20": () => page("<p>Illy decaf <b>20</b> pods</p>"),
      "https://shop.example.de/illy-20": () => page("<script>var x=7</script><p>20 Kapseln</p>"),
    };
    const check = createSourceCheck(async (url) => pages[url]?.() ?? page("", 404));
    expect(await check(HIGH_PACK)).toBeNull();
  });

  it("holds back when a page is missing or says something else", async () => {
    const check = createSourceCheck(async (url) =>
      url.includes("illy.com") ? page("<p>20 capsules</p>") : page("<p>200 Kapseln</p>"),
    );
    expect(await check(HIGH_PACK)).toMatch(/1 от цитираните сайтове/);
    const failing = createSourceCheck(async () => {
      throw new Error("blocked");
    });
    expect(await failing(HIGH_PACK)).toMatch(/0 от цитираните сайтове/);
  });

  it("reads a whole number, not part of another", () => {
    expect(printsNumber("20 pods", 20)).toBe(true);
    expect(printsNumber("x20 капсули", 20)).toBe(true);
    expect(printsNumber("200 pods", 20)).toBe(false);
    expect(printsNumber("1.20 €", 20)).toBe(false);
    expect(printsNumber("20,5 g", 20)).toBe(false);
  });
});

describe("reviewBatch", () => {
  const tinCandidate = candidate({
    id: "tin",
    slug: "illy-tin",
    name: "Дозети Illy Decaffeinato 18бр.",
    weightValue: "100.0000",
    weightUnit: "pc",
    sourceData: { packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." } },
  });
  const tinItem = workItem({
    id: "tin",
    slug: "illy-tin",
    pack: { label: "100 бр.", inName: "18 бр.", inPackField: "100 бр.", mayState: true },
    task: { writeCopy: true, research: true, researchReasons: ["conflict"] },
  });
  const context = (overrides: Partial<ReviewContext> = {}): ReviewContext => ({
    candidates: new Map([[tinCandidate.id, tinCandidate]]),
    summaries: new Map(),
    bodies: new Map(),
    model: "claude-opus-5-5",
    now: new Date("2026-10-19T12:00:00Z"),
    checkSources: pass,
    ...overrides,
  });
  const twentyPods = withBody("В кутията има 20 бр. дози.");

  it("applies a confident correction and lets the copy state the corrected size", async () => {
    const review = await reviewBatch(
      [tinItem],
      { products: [{ id: "tin", copy: twentyPods, research: HIGH_CORRECTION }] },
      context(),
    );
    const decision = review.decisions[0];
    expect(decision?.research.status).toBe("recorded");
    if (decision?.research.status !== "recorded") return;
    expect(decision.research.pack).toEqual({
      value: "20",
      unit: "pc",
      servings: "20",
      servingsEstimated: false,
    });
    expect(decision.research.record).toMatchObject({
      version: 2,
      applied: true,
      heldBack: null,
      before: { value: "100.0000", unit: "pc" },
      basis: researchBasis(tinCandidate),
    });
    expect(decision.copy.status).toBe("accepted");
  });

  it("holds back a correction whose pages do not confirm it", async () => {
    const review = await reviewBatch(
      [tinItem],
      { products: [{ id: "tin", copy: GOOD_COPY, research: HIGH_CORRECTION }] },
      context({ checkSources: async () => "0 от цитираните сайтове се отвориха" }),
    );
    expect(review.decisions[0]?.research).toMatchObject({
      status: "recorded",
      pack: null,
      record: { applied: false, heldBack: "0 от цитираните сайтове се отвориха" },
    });
  });

  it("holds back a weak correction, and then the copy may state no size", async () => {
    const review = await reviewBatch(
      [tinItem],
      {
        products: [{ id: "tin", copy: twentyPods, research: withPack({ confidence: "medium" }) }],
      },
      context(),
    );
    expect(review.decisions[0]?.research).toMatchObject({
      status: "recorded",
      pack: null,
      record: { applied: false, heldBack: "увереността е средна" },
    });
    expect(review.decisions[0]?.copy).toMatchObject({
      status: "rejected",
      problems: ["посочва размер на опаковката, докато размерът е спорен"],
    });
  });

  it("corrects a stored size the model calls confirmed against the name (the live case)", async () => {
    // Stored 100 from the pack field; the name and three shops say 16.
    const borbone = withPack({ value: 16 }, { verdict: "confirmed" });
    const review = await reviewBatch(
      [tinItem],
      { products: [{ id: "tin", copy: GOOD_COPY, research: borbone }] },
      context(),
    );
    expect(review.decisions[0]?.research).toMatchObject({
      status: "recorded",
      pack: { value: "16", unit: "pc" },
      record: { verdict: "confirmed", applied: true, heldBack: null },
    });
  });

  it("changes nothing when the size found is the stored one", async () => {
    const review = await reviewBatch(
      [tinItem],
      { products: [{ id: "tin", copy: GOOD_COPY, research: withPack({ value: 100 }) }] },
      context(),
    );
    expect(review.decisions[0]?.research).toMatchObject({
      status: "recorded",
      pack: null,
      record: { applied: false, heldBack: null },
    });
  });

  it("costs only the product whose answer is malformed, and notes stray ids", async () => {
    const other = candidate({ id: "other" });
    const items = [tinItem, workItem({ id: "other" })];
    const review = await reviewBatch(
      items,
      {
        products: [
          { id: "tin", copy: GOOD_COPY },
          { id: "other", copy: GOOD_COPY, research: null },
          { id: "someone-else", copy: GOOD_COPY, research: null },
        ],
      },
      context({
        candidates: new Map([
          [tinCandidate.id, tinCandidate],
          [other.id, other],
        ]),
      }),
    );
    expect(review.decisions[0]?.copy.status).toBe("rejected");
    expect(review.decisions[0]?.research.status).toBe("missing");
    expect(review.decisions[1]?.copy.status).toBe("accepted");
    expect(review.strayIds).toEqual(["someone-else"]);

    const unreadable = await reviewBatch([tinItem], { nothing: true }, context());
    expect(unreadable.decisions[0]?.copy.status).toBe("rejected");
  });

  it("rejects an answer that promises the wrong machines, with the reason the owner will see", async () => {
    const dg = candidate({
      id: "dg",
      slug: "rema-dg-espresso",
      name: "Капсули DG Rema Caffè Espresso 16 бр.",
      categoryKeys: ["dolce-gusto"],
      weightValue: "16.0000",
      weightUnit: "pc",
    });
    const item = workItem({
      id: "dg",
      slug: "rema-dg-espresso",
      format: "Капсули за Dolce Gusto",
      pack: { label: "16 бр.", inName: null, inPackField: null, mayState: true },
    });
    const answer = (sentence: string) => ({
      products: [{ id: "dg", copy: withBody(sentence), research: null }],
    });
    const ctx = () => context({ candidates: new Map([[dg.id, dg]]) });

    const loose = await reviewBatch(
      [item],
      answer("Капсулите пасват на всички машини Dolce Gusto."),
      ctx(),
    );
    expect(loose.decisions[0]?.copy).toEqual({
      status: "rejected",
      problems: [expect.stringMatching(/^съвместимост: „всички машини Dolce Gusto“/)],
    });

    const right = await reviewBatch(
      [item],
      answer("Капсулите пасват на класическите машини Dolce Gusto (не NEO)."),
      ctx(),
    );
    expect(right.decisions[0]?.copy.status).toBe("accepted");
  });

  it("does not accept the same summary for two products in one batch", async () => {
    const first = candidate({ id: "first" });
    const second = candidate({ id: "second" });
    const items = [workItem({ id: "first" }), workItem({ id: "second" })];
    const review = await reviewBatch(
      items,
      {
        products: [
          { id: "first", copy: GOOD_COPY, research: null },
          { id: "second", copy: GOOD_COPY, research: null },
        ],
      },
      context({
        candidates: new Map([
          [first.id, first],
          [second.id, second],
        ]),
      }),
    );
    expect(review.decisions.map((d) => d.copy.status)).toEqual(["accepted", "rejected"]);
  });
});

/* --- The skill ------------------------------------------------------------------- */

describe("the catalog-copy skill", () => {
  const skillFile = path.resolve(
    import.meta.dirname,
    "../../../.claude/skills/catalog-copy/SKILL.md",
  );

  it("tells the model the compatibility wording the audit holds it to", async () => {
    const skill = await readFile(skillFile, "utf8");
    for (const wording of Object.values(COMPATIBILITY_WORDING)) expect(skill).toContain(wording);
    for (const phrase of ["машини Dolce Gusto", "домашни машини Nespresso", "K-fee", "Cafissimo"]) {
      expect(skill).toContain(phrase);
    }
  });

  it("shows examples of the house style that the audit would let through", async () => {
    const skill = await readFile(skillFile, "utf8");
    const examples = [...skill.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(
      (match) => JSON.parse(match[1] as string) as { summary: string; body: string[] },
    );
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(compatibilityProblems([example.summary, ...example.body])).toEqual([]);
    }
  });
});

/* --- Plumbing ------------------------------------------------------------------- */

describe("plumbing", () => {
  it("escapes copy into paragraphs", () => {
    expect(paragraphsToHtml(["A & B", "<b>"])).toBe("<p>A &amp; B</p>\n<p>&lt;b&gt;</p>");
  });

  it("keeps a brand's products in one batch, and few researched ones to a prompt", () => {
    const items = ["a", "b", "a", "c", "b"].map((brand, index) =>
      workItem({ id: String(index), brand }),
    );
    expect(toBatches(items, 2).map((batch) => batch.map((item) => item.brand))).toEqual([
      ["a", "a"],
      ["b", "b"],
      ["c"],
    ]);
    const researched = Array.from({ length: 6 }, (_, index) =>
      workItem({
        id: `r${index}`,
        task: { writeCopy: true, research: true, researchReasons: ["x"] },
      }),
    );
    const sizes = toBatches([...researched, ...items], 10).map((batch) => batch.length);
    expect(sizes).toEqual([MAX_RESEARCH_PER_BATCH, 2, 5]);
  });

  it("scrubs credentials from text bound for a public log", () => {
    expect(scrubForLog("token sk-ant-oat01-abcDEF_123 and postgres://u:p@host/db done")).toBe(
      "token [redacted] and [redacted] done",
    );
  });
});
