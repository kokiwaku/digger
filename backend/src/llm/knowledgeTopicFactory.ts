import type { KnowledgeTopicService } from "./knowledgeTopic.js";
import { mockKnowledgeTopicService } from "./knowledgeTopic.mock.js";
import { vertexKnowledgeTopicService } from "./knowledgeTopic.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";

export function getKnowledgeTopicService(
  providerName: string = process.env.LLM_PROVIDER ?? "mock",
): KnowledgeTopicService {
  switch (providerName) {
    case "mock":
      return mockKnowledgeTopicService;
    case "vertex":
      return vertexKnowledgeTopicService;
    default:
      throw new LlmProviderError(`未知のLLM_PROVIDERです: ${providerName}`, "config_missing");
  }
}
