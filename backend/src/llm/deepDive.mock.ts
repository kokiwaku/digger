import { deepDiveResponseSchema, type DeepDiveService } from "./deepDive.js";

// モック実装: 本物のLLMは呼ばず、入力（記事の解析結果・質問・会話履歴）から
// それらしい固定応答を組み立てて返す。relatedConceptsは記事のconceptsから、
// suggestedFollowUpsは記事のdeepDiveQuestionsから（今回の質問を除いて）拾う。
export const mockDeepDiveService: DeepDiveService = {
  async ask(input) {
    const isFollowUp = input.conversationHistory.length > 0;

    const result = {
      answer: `「${input.question}」についてですね。${
        isFollowUp ? "これまでの会話も踏まえてお答えすると、" : ""
      }（モック応答）現時点では実際のLLMには接続されておらず、固定の説明文を返しています。実装が進むと、この記事の内容と会話の流れを踏まえた回答がここに表示されます。`,
      relatedConcepts: input.articleAnalysis.concepts.map((concept) => concept.name).slice(0, 3),
      suggestedFollowUps: input.articleAnalysis.deepDiveQuestions
        .filter((question) => question !== input.question)
        .slice(0, 2),
    };

    return deepDiveResponseSchema.parse(result);
  },
};
