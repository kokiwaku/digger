import {
  knowledgeTopicResultSchema,
  type KnowledgeTopicService,
} from "./knowledgeTopic.js";

// モック実装: LLMを使わず、concept自体を単一階層のtopicとして扱うだけの決定的なロジック。
// 実際の階層分類はvertex実装が行う。
export const mockKnowledgeTopicService: KnowledgeTopicService = {
  async classify(input) {
    const result = {
      assignments: input.items.map((item) => ({ id: item.id, path: [item.concept] })),
    };
    return knowledgeTopicResultSchema.parse(result);
  },
};
