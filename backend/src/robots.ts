import { ArticleFetchError } from "./errors.js";

const ROBOTS_FETCH_TIMEOUT_MS = 5_000;
const ROBOTS_PRODUCT_TOKEN = "digger";

type RobotsRule = { type: "allow" | "disallow"; path: string };

// 簡易的なrobots.txtパーサ。User-agentごとにグループ化し、Allow/Disallowを収集するのみで、
// crawl-delay/sitemap等の他ディレクティブは無視する（MVPとして必要最小限）。
export function parseRobotsTxt(text: string): Map<string, RobotsRule[]> {
  const groups = new Map<string, RobotsRule[]>();
  let currentAgents: string[] = [];
  let pendingRules: RobotsRule[] = [];

  const flush = () => {
    for (const agent of currentAgents) {
      groups.set(agent, (groups.get(agent) ?? []).concat(pendingRules));
    }
    currentAgents = [];
    pendingRules = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "user-agent") {
      if (pendingRules.length > 0) flush();
      currentAgents.push(value.toLowerCase());
    } else if ((key === "disallow" || key === "allow") && currentAgents.length > 0) {
      pendingRules.push({ type: key, path: value });
    }
  }
  flush();

  return groups;
}

// 最長一致したルールを採用する（Allow/Disallow問わず）。一致するルールがなければ許可。
export function isPathAllowed(rules: RobotsRule[], path: string): boolean {
  let best: { length: number; type: RobotsRule["type"] } | null = null;

  for (const rule of rules) {
    if (rule.path === "" || !path.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.length) {
      best = { length: rule.path.length, type: rule.type };
    }
  }

  return best ? best.type === "allow" : true;
}

async function fetchRobotsTxt(origin: string, userAgent: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROBOTS_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(new URL("/robots.txt", origin), {
      signal: controller.signal,
      headers: { "User-Agent": userAgent },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// robots.txtが取得できない場合（ネットワークエラー・404など）は、記事取得を妨げないよう
// 許可されているものとして扱う。方針はREADMEの「記事取得ポリシー」に明記する。
export async function ensureAllowedByRobots(url: URL, userAgent: string): Promise<void> {
  const robotsTxt = await fetchRobotsTxt(url.origin, userAgent);
  if (robotsTxt === null) return;

  const groups = parseRobotsTxt(robotsTxt);
  const rules = groups.get(ROBOTS_PRODUCT_TOKEN) ?? groups.get("*") ?? [];
  const path = `${url.pathname}${url.search}` || "/";

  if (!isPathAllowed(rules, path)) {
    throw new ArticleFetchError(`robots.txtにより取得が許可されていません: ${url.pathname}`, 403);
  }
}
