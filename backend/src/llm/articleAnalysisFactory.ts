import type { ArticleAnalysisService } from "./articleAnalysis.js";
import { mockArticleAnalysisService } from "./articleAnalysis.mock.js";
import { vertexArticleAnalysisService } from "./articleAnalysis.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";

// LLM_PROVIDER=mock（デフォルト）/ vertex を切り替えるだけの単純なfactory。
// llm/provider/llmProviderFactory.ts と同じパターン。DIコンテナ等は導入しない。
export function getArticleAnalysisService(
  providerName: string = process.env.LLM_PROVIDER ?? "mock",
): ArticleAnalysisService {
  switch (providerName) {
    case "mock":
      return mockArticleAnalysisService;
    case "vertex":
      return vertexArticleAnalysisService;
    default:
      throw new LlmProviderError(`未知のLLM_PROVIDERです: ${providerName}`, "config_missing");
  }
}
