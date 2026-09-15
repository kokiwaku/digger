import { LlmProviderError } from "./llmProviderError.js";
import { MockLlmProvider } from "./mockLlmProvider.js";
import { VertexGeminiProvider } from "./vertexGeminiProvider.js";
import type { LlmProvider } from "./llmProvider.js";

// LLM_PROVIDER=mock（デフォルト）/ vertex を切り替えるだけの単純なfactory。
// DIコンテナ等は導入せず、呼び出し側は getLlmProvider() を呼ぶだけでよい。
export function getLlmProvider(providerName: string = process.env.LLM_PROVIDER ?? "mock"): LlmProvider {
  switch (providerName) {
    case "mock":
      return new MockLlmProvider();
    case "vertex":
      return new VertexGeminiProvider();
    default:
      throw new LlmProviderError(`未知のLLM_PROVIDERです: ${providerName}`, "config_missing");
  }
}
