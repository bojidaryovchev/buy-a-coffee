import { normalizeLabel } from "@catalog/shared";
import type { ExistingProduct } from "./diff.ts";
import { identityToken } from "./identity.ts";
import type { NormalizedProduct } from "./normalize.ts";

/**
 * Move detection.
 *
 * Identity is source path + pack size, so when the source renames a URL the
 * product looks deleted and a twin looks new. This module pairs the two halves
 * of such a rename so the diff can re-point the existing row instead.
 *
 * Pure functions only, like the rest of the diff: no database, no network, no
 * clock.
 *
 * The asymmetry that shapes every rule here: a missed pairing costs a
 * duplicate that a person can see and repair with `catalog:link`; a wrong
 * pairing silently attaches one product's copy, slug and order history to
 * another and nobody is told. So a pair is only ever made when it is the
 * single reading the evidence allows. Anything else is left alone and
 * reported.
 *
 * Candidates are matched in passes, strongest evidence first. A product
 * paired — or found ambiguous — in one pass is never reconsidered by a weaker
 * one.
 *
 *   1. `sku`            both sides carry the same product code. The stored
 *                       side has it from an earlier read of the product page;
 *                       the discovered side has it only if the caller looked
 *                       it up and passed it in (`discoveredSkus`), because
 *                       the catalog blob does not carry one.
 *   2. `fingerprint`    brand key + normalised name + canonical pack size.
 *   3. `name_and_pack`  normalised name + pack size, the brand key differing
 *                       or absent on one side. The source re-files products
 *                       under brands (a brandless product gains one, a brand
 *                       slug is respelled), so brand cannot be a hard part of
 *                       identity — but without it the match is weaker, and it
 *                       is accepted only when an independent signal agrees.
 *
 * Within a pass, candidates sharing a key form a group. One old and one new
 * product is a pair. Anything larger is a tie, and is broken — or not — by the
 * ordered signals in `SIGNALS`.
 *
 * One limit on the code pass. At an address that is, or once was, shared by
 * two products (`sharedPaths`: two listed there now, a row flagged as sharing
 * its page, or a split key under it — `collisions.ts`), an equal code alone
 * does not move a row: the name must be the same name too, by `identityToken`.
 * There the stored code was read from a page two products share, and a code
 * the listing gives one of them can be the other's; moving on it would hand
 * the Espresso Bar's row, URL and order history to the Super Bar. Refused,
 * the row goes the ordinary way of a product no longer listed and the record
 * is created under its own key — a duplicate a person links, never a swap
 * nobody sees. Everywhere else the code moves rows exactly as before.
 */

export type MoveMatch = "sku" | "fingerprint" | "name_and_pack";

export type MoveSignal = "path_stem" | "price" | "images" | "description";

export interface MovePair {
  readonly existing: ExistingProduct;
  readonly product: NormalizedProduct;
  /** The pass that brought the two together. */
  readonly matchedBy: MoveMatch;
  /** The signal that broke a tie or corroborated a weak match, if one was needed. */
  readonly decidedBy: MoveSignal | null;
}

/**
 * Candidates that look like a rename but could not be paired safely.
 *
 *   - `tie`                   several candidates, and no signal singles one out.
 *   - `conflicting_evidence`  two signals point at different partners.
 *   - `uncorroborated`        a lone name-and-pack match with nothing else in
 *                             common.
 *   - `shared_address`        a stored row at an address that is or was shared
 *                             has the product code of a record under another
 *                             name, and nothing else paired it. The code alone
 *                             is not trusted there, so the row goes missing and
 *                             the record is created; this says the two may be
 *                             one product moved and renamed, for a person to
 *                             link (`catalog:link`) or leave.
 */
export interface UnresolvedMove {
  readonly matchedBy: MoveMatch;
  readonly reason: "tie" | "conflicting_evidence" | "uncorroborated" | "shared_address";
  /** Human-readable key the candidates share. */
  readonly fingerprint: string;
  readonly existingKeys: string[];
  readonly discoveredKeys: string[];
}

export interface MovePairing {
  readonly pairs: MovePair[];
  readonly unresolved: UnresolvedMove[];
}

export interface MovePairingOptions {
  /**
   * Product codes for discovered products, by source key, read from their
   * product pages before the diff. A missing entry means "not known".
   */
  readonly discoveredSkus?: ReadonlyMap<string, string>;
  /**
   * Source paths that are, or once were, shared by two products. A code alone
   * moves no row to or from one of them; see the note above.
   */
  readonly sharedPaths?: ReadonlySet<string>;
}

/** Everything the matcher knows about one side of a possible move. */
interface Facts {
  readonly sourceKey: string;
  readonly sku: string | null;
  readonly brand: string | null;
  readonly name: string;
  readonly pack: string | null;
  /** Source path without its trailing slash. */
  readonly stem: string | null;
  readonly price: string | null;
  readonly images: string | null;
  readonly description: string | null;
  /** The source path, as stored or listed. */
  readonly path: string | null;
  /** The name by `identityToken`, the normaliser split keys are built with. */
  readonly token: string;
}

interface OldSide {
  readonly facts: Facts;
  readonly existing: ExistingProduct;
}

interface NewSide {
  readonly facts: Facts;
  readonly product: NormalizedProduct;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function nameKey(value: unknown): string {
  return typeof value === "string" ? normalizeLabel(value).toLowerCase() : "";
}

function stemOf(path: string | null): string | null {
  if (!path || !path.startsWith("/")) return null;
  const stem = path.replace(/\/+$/, "");
  return stem === "" ? null : stem;
}

function imageKey(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const urls = value.filter((url): url is string => typeof url === "string" && url !== "");
  return urls.length === 0 ? null : [...urls].sort().join("\n");
}

/** Path-shaped keys carry their path; `sku:` and `id:` keys do not. */
function pathFromKey(sourceKey: string): string | null {
  if (!sourceKey.startsWith("/")) return null;
  const separator = sourceKey.indexOf("#");
  return separator === -1 ? sourceKey : sourceKey.slice(0, separator);
}

function factsOfExisting(existing: ExistingProduct): Facts {
  const { snapshot } = existing;
  return {
    sourceKey: existing.sourceKey,
    sku: text(existing.sku),
    brand: text(snapshot.brandKey),
    name: nameKey(snapshot.name),
    pack: text(snapshot.weight),
    stem: stemOf(existing.sourcePath ?? pathFromKey(existing.sourceKey)),
    price: text(snapshot.currentPrice),
    images: imageKey(snapshot.imageUrls),
    description: nameKey(snapshot.descriptionText) || null,
    path: existing.sourcePath ?? pathFromKey(existing.sourceKey),
    token: typeof snapshot.name === "string" ? identityToken(snapshot.name) : "",
  };
}

function factsOfDiscovered(
  product: NormalizedProduct,
  discoveredSkus: ReadonlyMap<string, string> | undefined,
): Facts {
  return {
    sourceKey: product.sourceKey,
    // What the listing itself states wins over what was looked up for it.
    sku: text(product.sku) ?? text(discoveredSkus?.get(product.sourceKey)),
    brand: text(product.brandKey),
    name: nameKey(product.name),
    pack: text(product.weight?.canonical),
    stem: stemOf(product.sourcePath),
    price: text(product.currentPrice?.amount),
    images: imageKey(product.sourceImageUrls),
    description: nameKey(product.descriptionText) || null,
    path: product.sourcePath,
    token: identityToken(product.name),
  };
}

/**
 * Tie-breakers, in the order they are consulted.
 *
 * Each scores one old/new combination: a number when the signal supports it
 * (higher is better), `null` when it says nothing. A signal names a pair only
 * when each side is the other's single best — see `mutualBest`.
 */
const SIGNALS: ReadonlyArray<{
  readonly name: MoveSignal;
  readonly score: (old: Facts, next: Facts) => number | null;
}> = [
  {
    /*
     * The source renames by appending: `/amann-cascada/` became
     * `/amann-cascada-500/`. The score is the length of what was appended,
     * negated, so that `/lavazza-crema-aroma-expert/` claims
     * `/lavazza-crema-aroma-expert-1/` ahead of `/lavazza-crema-aroma/`, whose
     * stem is a prefix of it too.
     */
    name: "path_stem",
    score: (old, next) => {
      if (!old.stem || !next.stem) return null;
      if (next.stem !== old.stem && !next.stem.startsWith(`${old.stem}-`)) return null;
      return old.stem.length - next.stem.length;
    },
  },
  {
    name: "price",
    score: (old, next) => (old.price !== null && old.price === next.price ? 1 : null),
  },
  {
    name: "images",
    score: (old, next) => (old.images !== null && old.images === next.images ? 1 : null),
  },
  {
    name: "description",
    score: (old, next) =>
      old.description !== null && old.description === next.description ? 1 : null,
  },
];

/** Two different product codes are two different products, whatever else agrees. */
function compatible(old: Facts, next: Facts): boolean {
  return !(old.sku !== null && next.sku !== null && old.sku !== next.sku);
}

interface Pass {
  readonly matchedBy: MoveMatch;
  /** Group key, or `null` when this product cannot take part in the pass. */
  readonly key: (facts: Facts) => string | null;
  readonly describe: (facts: Facts) => string;
  /** A lone pair is accepted only if at least one signal supports it. */
  readonly needsCorroboration: boolean;
}

const PASSES: readonly Pass[] = [
  {
    matchedBy: "sku",
    key: (facts) => facts.sku,
    describe: (facts) => `sku ${facts.sku ?? ""}`,
    needsCorroboration: false,
  },
  {
    matchedBy: "fingerprint",
    key: (facts) =>
      facts.name === "" ? null : JSON.stringify([facts.brand ?? "", facts.name, facts.pack ?? ""]),
    describe: (facts) =>
      `${facts.brand ?? "(no brand)"} | ${facts.name} | ${facts.pack ?? "(no pack size)"}`,
    needsCorroboration: false,
  },
  {
    matchedBy: "name_and_pack",
    key: (facts) => (facts.name === "" ? null : JSON.stringify([facts.name, facts.pack ?? ""])),
    describe: (facts) => `${facts.name} | ${facts.pack ?? "(no pack size)"}`,
    needsCorroboration: true,
  },
];

/**
 * The pairs a single signal vouches for: each side must be the other's one
 * best candidate. Two candidates scoring the same means the signal cannot
 * tell them apart, and it then says nothing about either.
 */
function mutualBest(
  score: (old: Facts, next: Facts) => number | null,
  olds: readonly OldSide[],
  news: readonly NewSide[],
  link: (old: Facts, next: Facts) => boolean,
): Map<OldSide, NewSide> {
  const strictBest = <Own, Other>(
    own: Own,
    others: readonly Other[],
    rate: (own: Own, other: Other) => number | null,
  ): Other | null => {
    let best: Other | null = null;
    let bestScore: number | null = null;
    let tied = false;
    for (const other of others) {
      const value = rate(own, other);
      if (value === null) continue;
      if (bestScore === null || value > bestScore) {
        best = other;
        bestScore = value;
        tied = false;
      } else if (value === bestScore) {
        tied = true;
      }
    }
    return tied ? null : best;
  };

  const rateFromOld = (old: OldSide, next: NewSide): number | null =>
    link(old.facts, next.facts) ? score(old.facts, next.facts) : null;
  const rateFromNew = (next: NewSide, old: OldSide): number | null => rateFromOld(old, next);

  const result = new Map<OldSide, NewSide>();
  for (const old of olds) {
    const next = strictBest(old, news, rateFromOld);
    if (next !== null && strictBest(next, olds, rateFromNew) === old) result.set(old, next);
  }
  return result;
}

interface GroupOutcome {
  readonly pairs: Array<{ old: OldSide; next: NewSide; decidedBy: MoveSignal | null }>;
  readonly unresolved: {
    reason: UnresolvedMove["reason"];
    olds: OldSide[];
    news: NewSide[];
  } | null;
}

function resolveGroup(
  pass: Pass,
  groupOlds: readonly OldSide[],
  news: readonly NewSide[],
  link: (old: Facts, next: Facts) => boolean,
): GroupOutcome {
  /*
   * A product we still list outranks one we already removed: the removed row
   * only gets to claim a new URL when no live row wants it.
   */
  const live = groupOlds.filter((old) => old.existing.status !== "removed");
  const olds = live.length > 0 ? live : groupOlds;

  const linked = (old: OldSide, next: NewSide): boolean => link(old.facts, next.facts);
  if (!olds.some((old) => news.some((next) => linked(old, next)))) {
    return { pairs: [], unresolved: null };
  }

  if (olds.length === 1 && news.length === 1) {
    const [old, next] = [olds[0] as OldSide, news[0] as NewSide];
    if (!pass.needsCorroboration)
      return { pairs: [{ old, next, decidedBy: null }], unresolved: null };
    const signal = SIGNALS.find((candidate) => candidate.score(old.facts, next.facts) !== null);
    return signal
      ? { pairs: [{ old, next, decidedBy: signal.name }], unresolved: null }
      : { pairs: [], unresolved: { reason: "uncorroborated", olds: [old], news: [next] } };
  }

  // A tie. Ask every signal for the pairs it vouches for, then take them in
  // order — unless another signal vouches for a different partner, in which
  // case the evidence contradicts itself and nobody is paired on it.
  const votes = SIGNALS.map((signal) => ({
    name: signal.name,
    pairs: mutualBest(signal.score, olds, news, link),
  }));

  const pairs: GroupOutcome["pairs"] = [];
  const pairedOlds = new Set<OldSide>();
  const pairedNews = new Set<NewSide>();
  let contradicted = false;

  for (const vote of votes) {
    for (const [old, next] of vote.pairs) {
      if (pairedOlds.has(old) || pairedNews.has(next)) continue;
      const disputed = votes.some((other) => {
        if (other === vote) return false;
        const rival = other.pairs.get(old);
        if (rival !== undefined && rival !== next) return true;
        for (const [otherOld, otherNext] of other.pairs) {
          if (otherNext === next && otherOld !== old) return true;
        }
        return false;
      });
      if (disputed) {
        contradicted = true;
        continue;
      }
      pairs.push({ old, next, decidedBy: vote.name });
      pairedOlds.add(old);
      pairedNews.add(next);
    }
  }

  const restOlds = olds.filter((old) => !pairedOlds.has(old));
  const restNews = news.filter((next) => !pairedNews.has(next));
  const stillTied = restOlds.some((old) => restNews.some((next) => linked(old, next)));

  return {
    pairs,
    unresolved: stillTied
      ? { reason: contradicted ? "conflicting_evidence" : "tie", olds: restOlds, news: restNews }
      : null,
  };
}

/**
 * Pair products that vanished under one key with products that appeared under
 * another.
 *
 * `absent` is every stored product this run did not see; `appeared` is every
 * discovered product whose key is not stored. The result is strictly
 * one-to-one: no product appears in two pairs.
 *
 * Still pure: any product code for the discovered side was fetched by the
 * caller beforehand and arrives as data.
 */
export function pairMoves(
  absent: readonly ExistingProduct[],
  appeared: readonly NormalizedProduct[],
  options: MovePairingOptions = {},
): MovePairing {
  const pairs: MovePair[] = [];
  const unresolved: UnresolvedMove[] = [];

  let olds: OldSide[] = absent.map((existing) => ({ existing, facts: factsOfExisting(existing) }));
  let news: NewSide[] = appeared.map((product) => ({
    product,
    facts: factsOfDiscovered(product, options.discoveredSkus),
  }));

  const shared = options.sharedPaths ?? new Set<string>();
  const atSharedAddress = (facts: Facts): boolean => facts.path !== null && shared.has(facts.path);
  /*
   * Codes never pair two different codes (`compatible`), and at a shared
   * address an equal code pairs only the same name.
   */
  const linkFor =
    (pass: Pass) =>
    (old: Facts, next: Facts): boolean =>
      compatible(old, next) &&
      (pass.matchedBy !== "sku" ||
        !(atSharedAddress(old) || atSharedAddress(next)) ||
        (old.token !== "" && old.token === next.token));

  /*
   * Code matches refused at a shared address, by row. Not settled by the
   * refusal — a weaker pass may still pair the row on its own name — but a row
   * that ends up paired with nothing is reported, never silently orphaned.
   */
  const refused = new Map<OldSide, Set<NewSide>>();

  for (const pass of PASSES) {
    if (olds.length === 0 || news.length === 0) break;

    const groups = new Map<string, { olds: OldSide[]; news: NewSide[] }>();
    const groupFor = (key: string) => {
      let group = groups.get(key);
      if (!group) {
        group = { olds: [], news: [] };
        groups.set(key, group);
      }
      return group;
    };
    for (const old of olds) {
      const key = pass.key(old.facts);
      if (key !== null) groupFor(key).olds.push(old);
    }
    for (const next of news) {
      const key = pass.key(next.facts);
      if (key !== null) groupFor(key).news.push(next);
    }

    const settledOlds = new Set<OldSide>();
    const settledNews = new Set<NewSide>();

    for (const group of groups.values()) {
      if (group.olds.length === 0 || group.news.length === 0) continue;
      const link = linkFor(pass);
      if (pass.matchedBy === "sku") {
        for (const old of group.olds) {
          for (const next of group.news) {
            if (!compatible(old.facts, next.facts) || link(old.facts, next.facts)) continue;
            const records = refused.get(old) ?? new Set<NewSide>();
            records.add(next);
            refused.set(old, records);
          }
        }
      }
      const outcome = resolveGroup(pass, group.olds, group.news, link);

      for (const { old, next, decidedBy } of outcome.pairs) {
        pairs.push({
          existing: old.existing,
          product: next.product,
          matchedBy: pass.matchedBy,
          decidedBy,
        });
        settledOlds.add(old);
        settledNews.add(next);
      }

      if (outcome.unresolved) {
        const sample = outcome.unresolved.news[0] as NewSide;
        unresolved.push({
          matchedBy: pass.matchedBy,
          reason: outcome.unresolved.reason,
          fingerprint: pass.describe(sample.facts),
          existingKeys: outcome.unresolved.olds.map((old) => old.facts.sourceKey).sort(),
          discoveredKeys: outcome.unresolved.news.map((next) => next.facts.sourceKey).sort(),
        });
        // Stronger evidence called these ambiguous; a weaker pass must not
        // then pair them on less.
        for (const old of outcome.unresolved.olds) settledOlds.add(old);
        for (const next of outcome.unresolved.news) settledNews.add(next);
      }
    }

    olds = olds.filter((old) => !settledOlds.has(old));
    news = news.filter((next) => !settledNews.has(next));
  }

  const pairedRows = new Set(pairs.map((pair) => pair.existing));
  for (const [old, records] of refused) {
    if (pairedRows.has(old.existing)) continue;
    unresolved.push({
      matchedBy: "sku",
      reason: "shared_address",
      fingerprint: `sku ${old.facts.sku ?? ""}`,
      existingKeys: [old.facts.sourceKey],
      discoveredKeys: [...records].map((next) => next.facts.sourceKey).sort(),
    });
  }

  return { pairs, unresolved };
}
