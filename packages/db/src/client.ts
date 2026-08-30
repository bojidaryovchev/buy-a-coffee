import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export type Database = ReturnType<typeof createDatabase>["db"];
export type Schema = typeof schema;

export interface DatabaseOptions {
  readonly url?: string;
  /**
   * Pool size. Lambda gets 1: a serverless container handles one invocation at
   * a time, and extra idle connections just exhaust the server's slots.
   */
  readonly max?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
  readonly ssl?: boolean | "require" | "prefer";
  readonly debug?: boolean;
}

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Point it at any standard PostgreSQL instance " +
        "(local Docker, Neon, RDS, ...). See .env.example.",
    );
    this.name = "MissingDatabaseUrlError";
  }
}

/**
 * Decide whether TLS is required.
 *
 * Managed providers need TLS; a local Docker container does not offer it at
 * all. Getting this wrong is the single most common first-run failure, so it
 * is derived from the URL instead of being a mandatory extra setting.
 */
export function resolveSsl(url: string, explicit?: DatabaseOptions["ssl"]): boolean | "require" {
  if (explicit !== undefined && explicit !== "prefer") return explicit;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode === "disable") return false;
  if (sslmode && sslmode !== "prefer") return "require";
  const host = parsed.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "db";
  return isLocal ? false : "require";
}

/**
 * Create a Drizzle client plus the underlying connection.
 *
 * The raw `sql` handle is returned so callers can close it deterministically;
 * a CLI that leaves the pool open simply never exits.
 */
export function createDatabase(options: DatabaseOptions = {}): {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sql: postgres.Sql;
  close: () => Promise<void>;
} {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new MissingDatabaseUrlError();

  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 15,
    ssl: resolveSsl(url, options.ssl),
    onnotice: () => {},
    // Keep numeric/decimal as strings. Casting money through a JS number would
    // reintroduce exactly the floating-point error the decimal layer avoids.
    types: {},
    prepare: false,
  });

  const db = drizzle(client, { schema, logger: options.debug ?? false });
  return {
    db,
    sql: client,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

export { schema };
