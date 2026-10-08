import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { BREWING_SYSTEMS, getBrewingSystem } from "@/lib/recommend/systems";
import { isPlaceholderImage, resolveImageUrl } from "./images";
import { HERO_SHELF_SIZE, type HeroShelfCandidate } from "./home-shelf";

/**
 * Reads that only the home page needs.
 *
 * The rules of `queries.ts` hold here too: only `status = 'active'` products,
 * only mirrored images (`object_key` set, `status = 'active'`), everything
 * parameterised, and a bounded number of round trips — this file adds exactly
 * one to the page.
 */

/**
 * Each brewing system's newest photographed products, ranked.
 *
 * One query for all systems. A system is matched on its category slug *or*
 * the source key behind it, as everywhere else (`lib/recommend/systems.ts`
 * explains why). "Newest" is `first_seen_at`, the same clock the new-arrivals
 * row uses; name and id break ties, because a first synchronisation stamps
 * many products within the same moment and the shelf must not depend on which
 * of them PostgreSQL happens to return first.
 *
 * `perSystem` rows come back for every system, not one: when fewer than six
 * systems hold a photographed product, `selectHeroShelf` fills the remaining
 * wells from the next newest. The result is at most
 * `BREWING_SYSTEMS.length × perSystem` small rows.
 */
export async function listHeroShelfCandidates(
  perSystem: number = HERO_SHELF_SIZE,
): Promise<readonly HeroShelfCandidate[]> {
  const limit = Math.max(1, Math.min(Math.trunc(perSystem), 12));

  const systems = sql.join(
    BREWING_SYSTEMS.map(
      (system) =>
        sql`(${system.id}::text, ${sql.param([...system.categorySlugs])}::text[], ${sql.param([...system.categorySourceKeys])}::text[])`,
    ),
    sql`, `,
  );

  const rows = await db.execute(sql`
    select system_id, id, slug, name, object_key, public_url, alt, width, height, rank
    from (
      select
        s.system_id,
        p.id,
        p.slug,
        p.name,
        img.object_key,
        img.public_url,
        img.alt,
        img.width,
        img.height,
        row_number() over (
          partition by s.system_id
          order by p.first_seen_at desc, p.name asc, p.id asc
        )::int as rank
      from (values ${systems}) as s (system_id, slugs, source_keys)
      join products p
        on p.status = 'active'
       and exists (
         select 1
         from product_categories pc
         join categories c on c.id = pc.category_id
         where pc.product_id = p.id
           and (c.slug = any(s.slugs) or c.source_key = any(s.source_keys))
       )
      join lateral (
        select pi.object_key, pi.public_url, pi.alt, pi.width, pi.height
        from product_images pi
        where pi.product_id = p.id
          and pi.status = 'active'
          and pi.object_key is not null
        order by pi.ordinal asc
        limit 1
      ) img on true
    ) ranked
    where rank <= ${limit}
    order by system_id, rank
  `);

  const candidates: HeroShelfCandidate[] = [];
  for (const row of rows as unknown as ReadonlyArray<Record<string, unknown>>) {
    const system = getBrewingSystem(String(row.system_id));
    // The object key, not the stored absolute URL — see `loadPrimaryImages`.
    const key = (row.object_key ?? row.public_url) as string | null;
    if (!system || !key) continue;

    // An image we cannot serve resolves to the placeholder, and a placeholder
    // is not a photograph: it has no place on a shelf of packshots.
    const url = resolveImageUrl(key);
    if (isPlaceholderImage(url)) continue;

    const name = String(row.name);
    candidates.push({
      id: String(row.id),
      slug: String(row.slug),
      name,
      systemId: system.id,
      rank: Number(row.rank),
      image: {
        url,
        alt: (row.alt as string | null) ?? name,
        width: row.width === null ? null : Number(row.width),
        height: row.height === null ? null : Number(row.height),
      },
    });
  }
  return candidates;
}
