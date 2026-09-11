import { fetchArticle } from "./articleFetcher.js";
import type { DigResult } from "./types.js";

export function parseArticleUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new Error("url is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("url is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must use http or https");
  }

  return parsed;
}

// 記事の取得・本文抽出は articleFetcher.ts が担当し、実際のtitleをここで組み込む。
// summary/whyItMatters/backgroundKnowledge はLLM未接続のため固定値のまま。
// TODO: article.textContent をLLMに渡してこれらを生成する。
export async function buildDigResult(url: URL): Promise<DigResult> {
  const article = await fetchArticle(url);

  return {
    source: {
      type: "web_article",
      url: url.toString(),
      title: article.title,
    },
    summary: "この記事の要約です。",
    whyItMatters: "なぜこの内容が重要なのかの説明です。",
    backgroundKnowledge: [
      {
        id: "knowledge-1",
        title: "前提知識A",
        summary: "このニュースを理解するために必要な前提知識です。",
      },
      {
        id: "knowledge-2",
        title: "前提知識B",
        summary: "もう1つの前提知識です。",
      },
    ],
  };
}
