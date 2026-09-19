import type { MemoryExtractionService } from "./memoryExtraction.js";
import { mockMemoryExtractionService } from "./memoryExtraction.mock.js";
import { vertexMemoryExtractionService } from "./memoryExtraction.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";

export function getMemoryExtractionService(
  providerName: string = process.env.LLM_PROVIDER ?? "mock",
): MemoryExtractionService {
  switch (providerName) {
    case "mock":
      return mockMemoryExtractionService;
    case "vertex":
      return vertexMemoryExtractionService;
    default:
      throw new LlmProviderError(`未知のLLM_PROVIDERです: ${providerName}`, "config_missing");
  }
}
