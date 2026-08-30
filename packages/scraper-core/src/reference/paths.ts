import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve paths against the workspace root rather than the current working
 * directory.
 *
 * Without this, `pnpm --filter @catalog/scraper ...` runs with the cwd set to
 * `apps/scraper`, and the reference artifacts land in `apps/scraper/reference/`
 * instead of the repository root. The storefront reads `reference/latest/` as
 * its contract, so a run from a different directory must not move it.
 */

const ROOT_MARKERS = ["pnpm-workspace.yaml", "pnpm-lock.yaml"];

export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  for (;;) {
    if (ROOT_MARKERS.some((marker) => existsSync(path.join(current, marker)))) return current;
    const parent = path.dirname(current);
    // Reached the filesystem root without finding a marker.
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

/** Resolve a possibly-relative path against the workspace root. */
export function resolveFromWorkspaceRoot(target: string, startDir?: string): string {
  if (path.isAbsolute(target)) return target;
  return path.resolve(findWorkspaceRoot(startDir), target);
}
