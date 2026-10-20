/**
 * The database a spec may write to, or an error before anything is written.
 *
 * A spec that writes rows (`promotion.spec.ts`) writes to `DATABASE_URL`,
 * which is whatever the shell running Playwright holds — and a shell that once
 * pointed at production for a migration may still. So a write is allowed only
 * to a server on this machine, or in CI, whose database is the job's own
 * service. The host is named in the error; the URL, with its password, is not.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function writableDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec writes to the build's database");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a URL");
  }
  if (process.env.CI || LOCAL_HOSTS.has(host)) return url;
  throw new Error(
    `Refusing to write to the database at ${host}: an end-to-end spec writes only to a local database, or CI's own.`,
  );
}
