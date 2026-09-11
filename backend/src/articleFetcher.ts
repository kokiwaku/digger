import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { ArticleFetchError } from "./errors.js";
import { assertPublicHost } from "./network.js";
import { ensureAllowedByRobots } from "./robots.js";

export { ArticleFetchError } from "./errors.js";

const FETCH_TIMEOUT_MS = 10_000;
const MIN_TEXT_LENGTH = 200;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export const USER_AGENT = "Digger/0.1 (+https://github.com/kokiwaku/digger)";

export type ExtractedArticle = {
  title: string;
  textContent: string;
};

async function fetchOnce(url: URL, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    throw new ArticleFetchError("記事URLへのアクセスに失敗しました", 502);
  }
}

// リダイレクトを手動で追跡し、ホップごとにSSRF対策(assertPublicHost)とrobots.txt確認を行う。
// こうすることで、最終的に到達したホストに対しても両方のチェックが適用される。
async function fetchHtml(initialUrl: URL): Promise<{ html: string; finalUrl: URL }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let currentUrl = initialUrl;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      await assertPublicHost(currentUrl);
      await ensureAllowedByRobots(currentUrl, USER_AGENT);

      const res = await fetchOnce(currentUrl, controller.signal);

      if (REDIRECT_STATUS_CODES.has(res.status)) {
        const location = res.headers.get("location");
        if (!location) {
          throw new ArticleFetchError("リダイレクト先が不明です", 502);
        }
        currentUrl = new URL(location, currentUrl);
        continue;
      }

      if (!res.ok) {
        throw new ArticleFetchError(`記事の取得に失敗しました (HTTP ${res.status})`, 502);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) {
        throw new ArticleFetchError("HTML以外のコンテンツは対応していません", 422);
      }

      return { html: await res.text(), finalUrl: currentUrl };
    }

    throw new ArticleFetchError("リダイレクトが多すぎます", 502);
  } finally {
    clearTimeout(timeout);
  }
}

// 汎用的なWeb記事を想定し、Mozilla Readability（Firefoxのリーダービューと同じ抽出エンジン）で
// nav/footer/広告などを除いた本文とタイトルを抽出する。ニュースサイト固有のパースは行わない。
function extractArticle(html: string, url: URL): ExtractedArticle {
  const dom = new JSDOM(html, { url: url.toString() });
  const parsed = new Readability(dom.window.document).parse();

  const title = parsed?.title?.trim() || dom.window.document.title.trim();
  const textContent = parsed?.textContent?.trim() ?? "";

  if (textContent.length < MIN_TEXT_LENGTH) {
    throw new ArticleFetchError("記事本文を抽出できませんでした", 422);
  }

  return { title: title || "(タイトル不明)", textContent };
}

export async function fetchArticle(url: URL): Promise<ExtractedArticle> {
  const { html, finalUrl } = await fetchHtml(url);
  return extractArticle(html, finalUrl);
}
