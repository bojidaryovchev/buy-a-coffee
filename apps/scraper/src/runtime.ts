import { createDatabase } from "@catalog/db";
import type { Database } from "@catalog/db";
import { createLogger, type Logger } from "@catalog/shared";
import { resolveDatabaseUrl } from "./secrets.ts";
import {
  Fetcher,
  type ScraperConfig,
  type StorageDriver,
  createStorageDriver,
  loadConfig,
} from "@catalog/scraper-core";

/**
 * Shared runtime wiring.
 *
 * The CLI and the Lambda both build their world here, which is what keeps the
 * promise that they run identical business logic rather than two drifting
 * copies of it.
 */

export interface Runtime {
  readonly config: ScraperConfig;
  readonly logger: Logger;
  readonly db: Database;
  readonly fetcher: Fetcher;
  readonly storage: StorageDriver;
  close(): Promise<void>;
}

export interface RuntimeOptions {
  readonly overrides?: Partial<Record<keyof ScraperConfig, unknown>>;
  /** Lambda uses a single connection; a CLI run can use a small pool. */
  readonly maxConnections?: number;
  readonly context?: Record<string, unknown>;
}

export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const config = loadConfig(options.overrides ?? {});
  const logger = createLogger({
    level: config.logLevel,
    base: { source: config.sourceKey, ...(options.context ?? {}) },
  });

  // Production supplies the connection string via Secrets Manager, so this
  // must be resolved before the pool is created.
  const url = await resolveDatabaseUrl();
  const { db, close } = createDatabase({ url, max: options.maxConnections ?? 5 });
  const fetcher = new Fetcher({ config, logger });
  const storage = createStorageDriver(config);

  logger.debug("runtime.ready", {
    baseUrl: config.baseUrl,
    storageDriver: storage.kind,
    concurrency: config.concurrency,
  });

  return { config, logger, db, fetcher, storage, close };
}
