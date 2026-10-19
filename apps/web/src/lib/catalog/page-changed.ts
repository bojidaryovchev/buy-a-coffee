import { sql } from "drizzle-orm";
import { products } from "@catalog/db/schema";

/**
 * When a product's PAGE last changed, as the sitemap and the page itself
 * report it.
 *
 * `last_changed_at` alone is the source's last real change - the sync moves
 * it and nothing else does, on purpose, because the sync's diff reads it. But
 * the page also changes when we change it: our own copy is written
 * (`copy_written_at`, by `copy:apply`, the admin or the copywriter), the
 * product page's facts are read in (`enriched_at`), or a researched pack size
 * comes into force (`facts_checked_at`, while `pack_override_value` is set).
 * A sitemap date that ignored those would tell search engines nothing changed
 * on the day the description was rewritten.
 *
 * `greatest` ignores nulls, so a product none of that has happened to keeps
 * its source date.
 */
export const productPageChangedAt = sql<Date>`greatest(
  ${products.lastChangedAt},
  ${products.copyWrittenAt},
  ${products.enrichedAt},
  case when ${products.packOverrideValue} is not null then ${products.factsCheckedAt} end
)`.mapWith(products.lastChangedAt);
