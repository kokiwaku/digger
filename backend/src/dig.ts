import { fetchArticle } from "./articleFetcher.js";
// LLMの実装を差し替えるときは、このimportを本物の実装に変えるだけでよい
// （ArticleAnalysisServiceインターフェースは変わらない想定）。
import { mockArticleAnalysisService as articleAnalysisService } from "./llm/articleAnalysis.mock.js";
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

// 記事の取得・本文抽出は articleFetcher.ts が担当し、Article Analysis（LLM処理、現在はモック）が
// summary/whyItMatters/concepts/entities/connections/deepDiveQuestions を生成する。
// ユーザーの知識・履歴は渡さない（Personalized AnalysisはArticle Analysisの後段の別処理）。
export async function buildDigResult(url: URL): Promise<DigResult> {
  const article = await fetchArticle(url);

  const analysis = await articleAnalysisService.analyze({
    title: article.title,
    url: url.toString(),
    content: article.textContent,
  });

  return {
    source: {
      type: "web_article",
      url: url.toString(),
      title: article.title,
    },
    analysis,
  };
}
