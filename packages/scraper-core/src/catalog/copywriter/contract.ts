import { z } from "zod";

/**
 * What the catalog copywriter sends to the model, and what it accepts back.
 *
 * The model works one BATCH at a time - up to ten products in one prompt - for
 * two reasons: products of one brand are written side by side, so sibling pack
 * sizes come out different from each other rather than the same paragraph
 * twice; and one prompt carries the instructions once instead of ten times.
 *
 * The answer is checked twice. The CLI holds the model to
 * `COPY_OUTPUT_JSON_SCHEMA` (shape and limits). Then each product's answer is
 * parsed here on its own (`productAnswerSchema`), so one product's slip costs
 * that product, not the batch: free-text research fields are trimmed to their
 * limits rather than refused, and a source that is not a web address is
 * dropped rather than failing the answer. Copy lengths are left to the audit,
 * which names the problem.
 */

/** One product, as the model sees it. */
export interface CopyWorkItem {
  /** Our product id; the model echoes it back. */
  readonly id: string;
  readonly slug: string;
  /** The shop's own name: "Lavazza Super Crema". */
  readonly title: string;
  readonly brand: string | null;
  /** "Капсули за Dolce Gusto", "Кафе на зърна", or null. */
  readonly format: string | null;
  /** Roasted coffee or instant: decides grams per cup. */
  readonly kind: "roasted" | "instant";
  readonly pack: {
    /**
     * The size we sell it as - what its price per cup is computed from:
     * "16 бр.", "1 кг". Null when unknown.
     */
    readonly label: string | null;
    /** The size the supplier's name states, when it disagrees with its pack field. */
    readonly inName: string | null;
    /** The size the supplier's pack field states, when it disagrees with its name. */
    readonly inPackField: string | null;
    /**
     * Whether the copy may state the pack size. False while an earlier check
     * found a different size that nobody has settled yet.
     */
    readonly mayState: boolean;
  };
  /** Current shelf price in euro, for context only - never written into copy. */
  readonly priceEur: string | null;
  /** Facts the catalog holds. Null means "not stated anywhere", not "no". */
  readonly facts: {
    readonly arabicaPercent: number | null;
    readonly origin: string | null;
    readonly roast: string | null;
    readonly attributes: Readonly<Record<string, string>>;
    readonly characteristics: readonly { readonly label: string; readonly value: string }[];
  };
  /**
   * The supplier's own description. A source of FACTS only: the copy must not
   * reuse its wording or its sentence order (audited after the fact).
   */
  readonly sourceDescription: string | null;
  /** Our published summaries for the same brand's other products, to stay distinct from. */
  readonly siblingSummaries: readonly string[];
  /**
   * Why the text written for this product last time was not published, as the
   * audit recorded it (`copy_last_error`), so a retry is not written blind.
   * Absent on a first attempt.
   */
  readonly previousRejection?: string;
  readonly task: {
    /** Write a summary and body for this product. */
    readonly writeCopy: boolean;
    /** Research the pack size and stated facts on the open web. */
    readonly research: boolean;
    /** Why research was asked for, in plain words. */
    readonly researchReasons: readonly string[];
  };
}

export interface CopyBatch {
  /** Format version of this file, so a skill and a runner can disagree loudly. */
  readonly version: 1;
  readonly products: readonly CopyWorkItem[];
}

export const CONFIDENCES = ["high", "medium", "low"] as const;
export const PACK_UNITS = ["g", "pc", "ml"] as const;
export const VERDICTS = ["confirmed", "corrected", "inconclusive"] as const;

/** Limits shared by the JSON Schema and the parser, so they cannot drift. */
export const LIMITS = {
  summary: 400,
  paragraph: 1200,
  paragraphs: 6,
  field: 60,
  value: 200,
  note: 600,
  sources: 10,
  findings: 20,
} as const;

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Trimmed and cut to `max`. */
const text = (max: number) => z.string().transform((value) => value.trim().slice(0, max));

/** Web addresses only; anything else (a shop's name, a bare EAN) is dropped. */
const sources = z
  .array(z.string())
  .transform((urls) => urls.filter(isWebAddress).slice(0, LIMITS.sources));

export const researchSchema = z.object({
  /** What the pack size turned out to be, by the evidence found. */
  verdict: z.enum(VERDICTS),
  pack: z
    .object({
      value: z.number().finite().positive(),
      unit: z.enum(PACK_UNITS),
      confidence: z.enum(CONFIDENCES),
      sources,
    })
    .nullable(),
  /** Other stated facts checked: arabica share, origin, roast, intensity... */
  findings: z
    .array(
      z.object({
        field: text(LIMITS.field).pipe(z.string().min(1)),
        ours: z
          .string()
          .nullable()
          .transform((value) => (value === null ? null : value.trim().slice(0, LIMITS.value))),
        found: text(LIMITS.value).pipe(z.string().min(1)),
        confidence: z.enum(CONFIDENCES),
        sources,
      }),
    )
    .transform((findings) => findings.slice(0, LIMITS.findings)),
  note: text(LIMITS.note),
});

export type CopyResearch = z.output<typeof researchSchema>;

export const copySchema = z.object({
  summary: z.string(),
  body: z.array(z.string()).min(1).max(LIMITS.paragraphs),
});

export type GeneratedCopy = z.output<typeof copySchema>;

/** One product's answer, parsed on its own. */
export const productAnswerSchema = z.object({
  id: z.string().min(1),
  copy: copySchema.nullable(),
  research: researchSchema.nullable(),
});

export type ProductAnswer = z.output<typeof productAnswerSchema>;

/** The envelope: the per-product answers are parsed one by one. */
export const copyOutputEnvelopeSchema = z.object({ products: z.array(z.unknown()) });

/** The whole answer at once - what a well-formed answer looks like. */
export const copyOutputSchema = z.object({ products: z.array(productAnswerSchema) });

export type CopyOutput = z.input<typeof copyOutputSchema>;

const sourceList = {
  type: "array",
  maxItems: LIMITS.sources,
  items: { type: "string", pattern: "^https?://" },
} as const;

/**
 * The same contract as JSON Schema, for `claude -p --json-schema`.
 *
 * Written out rather than generated from the zod schema: this repository has
 * no zod-to-json-schema dependency, and the shape is small and stable. The
 * limits come from `LIMITS`, and the tests assert the two agree on a sample.
 */
export const COPY_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["products"],
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "copy", "research"],
        properties: {
          id: { type: "string", minLength: 1 },
          copy: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["summary", "body"],
                properties: {
                  summary: { type: "string", minLength: 1, maxLength: LIMITS.summary },
                  body: {
                    type: "array",
                    minItems: 1,
                    maxItems: LIMITS.paragraphs,
                    items: { type: "string", minLength: 1, maxLength: LIMITS.paragraph },
                  },
                },
              },
            ],
          },
          research: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["verdict", "pack", "findings", "note"],
                properties: {
                  verdict: { type: "string", enum: [...VERDICTS] },
                  pack: {
                    anyOf: [
                      { type: "null" },
                      {
                        type: "object",
                        additionalProperties: false,
                        required: ["value", "unit", "confidence", "sources"],
                        properties: {
                          value: { type: "number", exclusiveMinimum: 0 },
                          unit: { type: "string", enum: [...PACK_UNITS] },
                          confidence: { type: "string", enum: [...CONFIDENCES] },
                          sources: sourceList,
                        },
                      },
                    ],
                  },
                  findings: {
                    type: "array",
                    maxItems: LIMITS.findings,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["field", "ours", "found", "confidence", "sources"],
                      properties: {
                        field: { type: "string", minLength: 1, maxLength: LIMITS.field },
                        ours: {
                          anyOf: [{ type: "null" }, { type: "string", maxLength: LIMITS.value }],
                        },
                        found: { type: "string", minLength: 1, maxLength: LIMITS.value },
                        confidence: { type: "string", enum: [...CONFIDENCES] },
                        sources: sourceList,
                      },
                    },
                  },
                  note: { type: "string", maxLength: LIMITS.note },
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;
