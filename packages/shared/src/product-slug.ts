/**
 * Product slugs: `<brand>-<line>-<format>-<qty>`, unique, and the same
 * whichever way the catalog was built.
 *
 * `productName().slugBase` is the slug a product would have if it were alone
 * in the world. This module settles the two things that can stop it having
 * that: another product with the same base, and a page that already lives at
 * that address.
 *
 * **The rule is about the product, never about who arrived first.** A slug
 * that depends on arrival order is a different slug in two databases that
 * hold the same products, and the shop has exactly that case: one database
 * got its products from the sync and then renamed them all at once, the other
 * renames some and has the sync create the rest. Their URLs, and the written
 * copy keyed by them, must be the same. So:
 *
 *   - a product alone on its base, whose base is not reserved, has the base;
 *   - otherwise it has `<base>-<discriminator>`, where the discriminator is
 *     derived from the product's own source key and nothing else.
 *
 * "Otherwise" includes *every* product in a group that shares a base. Nobody
 * keeps the bare base for having been there first, because "first" is the one
 * thing two databases can disagree on.
 *
 * Two functions apply the rule. `planProductSlugs` is the whole truth: given
 * every product, it says what each slug should be, and `catalog:reslug` moves
 * the ones that differ. `allocateProductSlug` is what the sync can know when a
 * single product arrives: its own base, and what is already taken. It gives
 * the newcomer exactly what the plan would, and leaves the product it collided
 * with alone, because a slug is allocated once and the sync never moves one.
 * That older product is then one `catalog:reslug` away from the plan, which is
 * a decision for a person, with a plan to read first.
 */

/**
 * Six characters that are a function of the source key alone.
 *
 * FNV-1a rather than SHA-256 from `hash.ts`: this module is imported wherever
 * a product name is, and must not pull `node:crypto` in with it. It is a
 * disambiguator between two or three products, not a fingerprint.
 */
export function slugDiscriminator(sourceKey: string): string {
  let hash = 0x811c9dc5;
  for (const char of new TextEncoder().encode(sourceKey)) {
    hash ^= char;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, "0").slice(-6);
}

export function discriminatedSlug(base: string, sourceKey: string): string {
  return `${base}-${slugDiscriminator(sourceKey)}`;
}

/**
 * The slug for one product arriving in a catalog that already exists.
 *
 * `isTaken` answers for everything that already owns an address: every
 * product's slug, every slug a product used to have (it still redirects),
 * every route and every category.
 */
export function allocateProductSlug(
  base: string,
  sourceKey: string,
  isTaken: (slug: string) => boolean,
): string {
  if (!isTaken(base)) return base;
  const discriminated = discriminatedSlug(base, sourceKey);
  if (!isTaken(discriminated)) return discriminated;
  // Two source keys with one hash and one name, or a rerun over a
  // half-written table. Never seen; never left to produce a duplicate either.
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${discriminated}-${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate a unique slug for ${JSON.stringify(sourceKey)}`);
}

export interface SlugPlanProduct {
  /** Stable identity of the row, used only to report the result. */
  readonly sourceKey: string;
  /** `productName(...).slugBase` for this product. */
  readonly base: string;
  /** Slugs this product has had before. They keep redirecting to it. */
  readonly previousSlugs?: readonly string[];
}

/**
 * The slug every product should have, keyed by source key.
 *
 * A function of the set of products and of `reserved`, and of nothing else:
 * not of the order they are given in, and not of the slugs they have now.
 * That is what makes it safe to run twice, and what makes two databases with
 * the same products agree.
 *
 * A base is contested, and so nobody gets it bare, when it is reserved, when
 * two products share it, or when it is an address another product used to
 * have: that address must keep leading to that product.
 */
export function planProductSlugs(
  products: readonly SlugPlanProduct[],
  reserved: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const sharing = new Map<string, number>();
  const formerOwners = new Map<string, Set<string>>();
  for (const product of products) {
    sharing.set(product.base, (sharing.get(product.base) ?? 0) + 1);
    for (const slug of product.previousSlugs ?? []) {
      const owners = formerOwners.get(slug) ?? new Set<string>();
      owners.add(product.sourceKey);
      formerOwners.set(slug, owners);
    }
  }

  const heldByAnother = (slug: string, sourceKey: string): boolean => {
    const owners = formerOwners.get(slug);
    return owners !== undefined && (owners.size > 1 || !owners.has(sourceKey));
  };

  const plan = new Map<string, string>();
  const assigned = new Map<string, string>();
  for (const product of products) {
    if (plan.has(product.sourceKey)) {
      throw new Error(`Two products share the source key ${JSON.stringify(product.sourceKey)}`);
    }
    const contested =
      reserved.has(product.base) ||
      (sharing.get(product.base) ?? 0) > 1 ||
      heldByAnother(product.base, product.sourceKey);
    const slug = contested ? discriminatedSlug(product.base, product.sourceKey) : product.base;

    const clash = assigned.get(slug);
    if (clash !== undefined || reserved.has(slug)) {
      // A discriminated slug landing on another slug. Order-free rules have
      // no honest answer to that, so it is a failure to look at, not a `-2`.
      throw new Error(
        `Slug ${JSON.stringify(slug)} for ${JSON.stringify(product.sourceKey)} is already ` +
          (clash !== undefined ? `planned for ${JSON.stringify(clash)}` : "reserved"),
      );
    }
    assigned.set(slug, product.sourceKey);
    plan.set(product.sourceKey, slug);
  }
  return plan;
}

export interface SlugMove {
  readonly sourceKey: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The products whose slug is not the planned one, and where each should go.
 *
 * In source-key order, so the plan a person reads and the writes that follow
 * it come out the same on every machine. Empty when the catalog already
 * matches the plan, which is what makes `catalog:reslug` safe to run twice.
 */
export function planSlugMoves(
  products: ReadonlyArray<SlugPlanProduct & { readonly slug: string }>,
  reserved: ReadonlySet<string> = new Set(),
): SlugMove[] {
  const plan = planProductSlugs(products, reserved);
  return products
    .map((product) => ({
      sourceKey: product.sourceKey,
      from: product.slug,
      to: plan.get(product.sourceKey) ?? product.slug,
    }))
    .filter((move) => move.from !== move.to)
    .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0));
}
