import type { KnowledgeExtractionService } from "./knowledgeExtraction.js";
import { mockKnowledgeExtractionService } from "./knowledgeExtraction.mock.js";
import { vertexKnowledgeExtractionService } from "./knowledgeExtraction.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";

export function getKnowledgeExtractionService(
  providerName: string = process.env.LLM_PROVIDER ?? "mock",
): KnowledgeExtractionService {
  switch (providerName) {
    case "mock":
      return mockKnowledgeExtractionService;
    case "vertex":
      return vertexKnowledgeExtractionService;
    default:
      throw new LlmProviderError(`未知のLLM_PROVIDERです: ${providerName}`, "config_missing");
  }
}
