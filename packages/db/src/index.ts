export { MissingDatabaseUrlError, createDatabase, resolveSsl } from "./client.ts";
export type { Database, DatabaseOptions, Schema } from "./client.ts";
export { PENDING_MIGRATIONS_DIR, applyPendingMigrations } from "./pending.ts";

/** Namespaced access: `schema.products`. */
export * as schema from "./schema/index.ts";
/** Flat access: `products`. */
export * from "./schema/index.ts";
