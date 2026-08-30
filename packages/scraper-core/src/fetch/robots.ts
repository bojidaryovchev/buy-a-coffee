/**
 * A deliberately small robots.txt implementation.
 *
 * It supports the directives that matter for polite crawling — User-agent,
 * Allow, Disallow, Crawl-delay, Sitemap — using the longest-match rule from
 * the REP draft. Anything it cannot understand is treated as "allowed", which
 * matches how the major crawlers behave.
 */

export interface RobotsRule {
  readonly type: "allow" | "disallow";
  readonly path: string;
}

export interface RobotsGroup {
  readonly agents: string[];
  readonly rules: RobotsRule[];
  readonly crawlDelaySeconds: number | null;
}

export interface RobotsTxt {
  readonly groups: RobotsGroup[];
  readonly sitemaps: string[];
}

export const ALLOW_ALL: RobotsTxt = { groups: [], sitemaps: [] };

export function parseRobotsTxt(content: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let crawlDelay: number | null = null;
  let collectingAgents = false;

  const flush = (): void => {
    if (agents.length > 0) {
      groups.push({ agents: [...agents], rules: [...rules], crawlDelaySeconds: crawlDelay });
    }
    agents = [];
    rules = [];
    crawlDelay = null;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case "user-agent": {
        // Consecutive User-agent lines share one rule block.
        if (!collectingAgents) flush();
        agents.push(value.toLowerCase());
        collectingAgents = true;
        break;
      }
      case "allow":
      case "disallow": {
        collectingAgents = false;
        if (agents.length === 0) break;
        // "Disallow:" with an empty value means "allow everything".
        if (field === "disallow" && value === "") break;
        rules.push({ type: field, path: value });
        break;
      }
      case "crawl-delay": {
        collectingAgents = false;
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed) && parsed >= 0) crawlDelay = parsed;
        break;
      }
      case "sitemap": {
        if (value) sitemaps.push(value);
        break;
      }
      default:
        collectingAgents = false;
    }
  }
  flush();

  return { groups, sitemaps };
}

/** Select the most specific group for a user agent, falling back to `*`. */
export function selectGroup(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  let wildcard: RobotsGroup | null = null;
  let best: { group: RobotsGroup; length: number } | null = null;

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === "*") {
        wildcard ??= group;
        continue;
      }
      if (ua.includes(agent) && (best === null || agent.length > best.length)) {
        best = { group, length: agent.length };
      }
    }
  }
  return best?.group ?? wildcard;
}

/** Convert a robots path pattern (`*` and `$` wildcards) to a regular expression. */
function patternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string;
    if (char === "*") {
      source += ".*";
    } else if (char === "$" && i === pattern.length - 1) {
      source += "$";
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}`);
}

/**
 * Longest-match wins; an Allow of equal length beats a Disallow, which is what
 * lets `Disallow: /` plus `Allow: /public/` behave as intended.
 */
export function isPathAllowed(group: RobotsGroup | null, pathWithQuery: string): boolean {
  if (!group || group.rules.length === 0) return true;

  let decision: { type: "allow" | "disallow"; length: number } | null = null;
  for (const rule of group.rules) {
    if (!patternToRegExp(rule.path).test(pathWithQuery)) continue;
    const length = rule.path.length;
    if (
      decision === null ||
      length > decision.length ||
      (length === decision.length && rule.type === "allow")
    ) {
      decision = { type: rule.type, length };
    }
  }
  return decision === null || decision.type === "allow";
}

export function isUrlAllowed(robots: RobotsTxt, userAgent: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isPathAllowed(selectGroup(robots, userAgent), `${parsed.pathname}${parsed.search}`);
}
