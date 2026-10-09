import { describe, expect, it } from "vitest";
import {
  MAX_INTERNAL_RUN_WORDS,
  MAX_SOURCE_RUN_WORDS,
  type OwnPiece,
  type SourceText,
  auditOwnContent,
  collectStrings,
  longestSharedRun,
  ownContentPieces,
  productCopyPieces,
  sharedShare,
  sourceTexts,
} from "../scripts/content-audit";
import { loadReferencePages, loadReferenceSnapshot } from "../scripts/copy-audit";

/*
 * The audit that holds our hand-written content — category introductions, the
 * Vending and Consumables pages, the journal — against the source's text and
 * against itself. The first half proves the audit can fail, with synthetic
 * text; the second runs it on the content as it is.
 */

const SOURCE: SourceText = {
  id: "product:test",
  text:
    "Този бленд представлява внимателно подбрана комбинация от арабика и робуста, " +
    "изпичана за максимално развитие на аромата и балансиран вкус в чашата.",
};

const piece = (id: string, text: string, kind: OwnPiece["kind"] = "category"): OwnPiece => ({
  id,
  kind,
  text,
});

describe("longestSharedRun", () => {
  it("counts consecutive words, ignoring case and punctuation", () => {
    expect(longestSharedRun("Едно, две; ТРИ четири", "и едно две три пет")).toBe(3);
  });

  it("is zero for texts with nothing in common", () => {
    expect(longestSharedRun("кафе чай", "вода сок")).toBe(0);
  });

  it("does not bridge a gap: two short runs are not one long run", () => {
    expect(longestSharedRun("а б в г д е ж", "а б в x д е ж")).toBe(3);
  });
});

describe("sharedShare", () => {
  it("is measured against the smaller text", () => {
    const small = "едно две три четири пет шест";
    const big = `${small} седем осем девет десет единайсет дванайсет тринайсет`;
    expect(sharedShare(small, big)).toBe(1);
    expect(sharedShare(big, small)).toBe(1);
  });

  it("is zero for texts too short to hold a five-word phrase", () => {
    expect(sharedShare("едно две", "едно две")).toBe(0);
  });
});

describe("collectStrings", () => {
  it("finds every string in nested copy, and nothing else", () => {
    expect(collectStrings({ a: "x", b: ["y", { c: "z", d: 4, e: null }] })).toEqual([
      "x",
      "y",
      "z",
    ]);
  });
});

describe("auditOwnContent: against the source", () => {
  it("passes writing of our own", () => {
    const audit = auditOwnContent(
      [
        piece(
          "category:own",
          "Капсулите са за машини, в които слагате капсула и машината прави останалото.",
        ),
      ],
      [SOURCE],
    );
    expect(audit.findings).toEqual([]);
    expect(audit.maxSourceRun).toBeLessThan(MAX_SOURCE_RUN_WORDS);
  });

  it("fails a sentence lifted from the source even when it is a small part of a long piece", () => {
    // A long source description, so that a lifted sentence is a small share of it.
    const source: SourceText = {
      id: "product:long-source",
      text: Array.from({ length: 70 }, (_, i) => `дума${i}`).join(" "),
    };
    const lifted = "дума20 дума21 дума22 дума23 дума24 дума25 дума26 дума27 дума28";
    const long = `${"думи за нещо съвсем различно ".repeat(40)} ${lifted} ${"още думи от нас ".repeat(40)}`;

    const audit = auditOwnContent([piece("journal:long", long, "journal")], [source]);

    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]).toMatchObject({ piece: "journal:long", against: source.id });
    expect(audit.findings[0]?.detail).toMatch(/run of \d+ consecutive words/);
    // The ratio alone would not have caught it: that is why the run exists.
    expect(audit.maxSourceOverlap).toBeLessThan(0.35);
  });

  it("allows a short coincidence, below the run limit", () => {
    const shared = "бленд от арабика и робуста"; // 5 words
    expect(shared.split(" ").length).toBeLessThan(MAX_SOURCE_RUN_WORDS);
    const audit = auditOwnContent([piece("category:a", `Нашият ${shared} е различен.`)], [SOURCE]);
    expect(audit.findings).toEqual([]);
  });

  it("fails when most of a short source survives, even in short runs", () => {
    // Every other word is changed, so no run is long but most phrases are shared.
    const source = {
      id: "page:test",
      text: "едно две три четири пет шест седем осем девет десет единайсет дванайсет",
    };
    const audit = auditOwnContent(
      [piece("category:echo", `${source.text} ${source.text}`)],
      [source],
    );
    expect(audit.findings.length).toBeGreaterThan(0);
  });

  it("does not compare product copy with the source: that has its own audit", () => {
    const audit = auditOwnContent([piece("product:x", SOURCE.text, "product")], [SOURCE]);
    expect(audit.findings).toEqual([]);
  });
});

describe("auditOwnContent: between our own pieces", () => {
  const paragraph =
    "Капсулите от различните системи не са взаимозаменяеми и затова първо намерете своята система, после избирайте по вкус и по размер на опаковката";

  it("fails a paragraph pasted into two pieces", () => {
    const audit = auditOwnContent(
      [
        piece("category:a", `Първо. ${paragraph}. Край на първия текст.`),
        piece("journal:b", `Друго начало. ${paragraph}. Друг край на втория.`, "journal"),
      ],
      [],
    );
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]?.detail).toMatch(/repeats a run of \d+ consecutive words/);
    expect(audit.maxInternalRun).toBeGreaterThan(MAX_INTERNAL_RUN_WORDS);
  });

  it("allows the same stock explanation in different words", () => {
    const audit = auditOwnContent(
      [
        piece("category:a", "Капсулите на една система не стават за машина на друга система."),
        piece("category:b", "Всяка система има своя капсула и тя не пасва другаде."),
      ],
      [],
    );
    expect(audit.findings).toEqual([]);
  });

  it("compares a new piece with product copy, but not product copy with product copy", () => {
    const text = `Начало. ${paragraph}. Край.`;
    const withProduct = auditOwnContent(
      [piece("category:a", text), piece("product:p", text, "product")],
      [],
    );
    expect(withProduct.findings).toHaveLength(1);

    const productsOnly = auditOwnContent(
      [piece("product:p", text, "product"), piece("product:q", text, "product")],
      [],
    );
    expect(productsOnly.findings).toEqual([]);
  });
});

describe("the content as it is", () => {
  const pieces = ownContentPieces();

  it("covers the eight category introductions, both business pages, every landing and every article", async () => {
    const kinds = (kind: string) => pieces.filter((p) => p.kind === kind).map((p) => p.id);
    expect(kinds("category")).toHaveLength(8);
    expect(kinds("business")).toEqual(["business:vending", "business:consumables"]);
    // The four listings, and the machine pages with the cross-links between them.
    expect(kinds("landing")).toHaveLength(5);
    expect(kinds("journal").length).toBeGreaterThanOrEqual(4);
    for (const p of pieces) expect(p.text.trim().length, p.id).toBeGreaterThan(100);
  });

  it("shares no long run of words with the source, and repeats nothing", async () => {
    const snapshot = await loadReferenceSnapshot();
    expect(snapshot, "reference/latest must be committed").not.toBeNull();
    const sources = sourceTexts(snapshot!.products, await loadReferencePages());
    expect(sources.length).toBeGreaterThan(100);

    const audit = auditOwnContent([...pieces, ...productCopyPieces()], sources);
    expect(audit.findings).toEqual([]);
  });

  it("uses the snapshot's product descriptions and page meta descriptions, and says what it lacks", async () => {
    const snapshot = await loadReferenceSnapshot();
    const pages = await loadReferencePages();
    const sources = sourceTexts(snapshot!.products, pages);
    expect(sources.some((s) => s.id.startsWith("product:"))).toBe(true);
    expect(sources.some((s) => s.id.startsWith("page:"))).toBe(true);
    // Category pages are compared through their meta descriptions, which the
    // crawl records; their body text is not recorded, and the audit says so.
    expect(sources.some((s) => /^page:(category|subcategory):/.test(s.id))).toBe(true);
  });
});
