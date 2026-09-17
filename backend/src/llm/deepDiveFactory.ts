import type { DeepDiveService } from "./deepDive.js";
import { mockDeepDiveService } from "./deepDive.mock.js";
import { vertexDeepDiveService } from "./deepDive.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";

// LLM_PROVIDER=mock（デフォルト）/ vertex を切り替えるだけの単純なfactory。
// articleAnalysisFactory.ts / llmProviderFactory.ts と同じパターン。
export function getDeepDiveService(
  providerName: string = process.env.LLM_PROVIDER ?? "mock",
): DeepDiveService {
  switch (providerName) {
    case "mock":
      return mockDeepDiveService;
    case "vertex":
      return vertexDeepDiveService;
    default:
      throw new LlmProviderError(`未知のLLM_PROVIDERです: ${providerName}`, "config_missing");
  }
}
