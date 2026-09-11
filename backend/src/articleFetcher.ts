import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const FETCH_TIMEOUT_MS = 10_000;
const MIN_TEXT_LENGTH = 200;
const USER_AGENT =
  "Mozilla/5.0 (compatible; DiggerBot/0.1; +https://github.com/kokiwaku/digger)";

type ArticleFetchStatus = 422 | 502;

export class ArticleFetchError extends Error {
  readonly status: ArticleFetchStatus;

  constructor(message: string, status: ArticleFetchStatus) {
    super(message);
    this.status = status;
  }
}

export type ExtractedArticle = {
  title: string;
  textContent: string;
};

async function fetchHtml(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    throw new ArticleFetchError("記事URLへのアクセスに失敗しました", 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new ArticleFetchError(`記事の取得に失敗しました (HTTP ${res.status})`, 502);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) {
    throw new ArticleFetchError("HTML以外のコンテンツは対応していません", 422);
  }

  return res.text();
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
  const html = await fetchHtml(url);
  return extractArticle(html, url);
}
