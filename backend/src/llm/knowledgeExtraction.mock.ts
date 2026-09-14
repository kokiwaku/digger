import {
  knowledgeExtractionOutputSchema,
  type KnowledgeExtractionService,
} from "./knowledgeExtraction.js";

// モック実装: 対話内容(input.conversation)は解析せず、デモとして分かりやすい
// 固定の候補を1件返す。実際のLLM実装では対話ログから候補を抽出することになる。
export const mockKnowledgeExtractionService: KnowledgeExtractionService = {
  async extract() {
    const result = [
      {
        concept: "政策金利",
        statement: "政策金利の変更は市場金利や銀行の貸出金利に波及しうる",
        evidence: "ユーザーが利上げと住宅ローンの関係を自分の言葉で確認した",
        confidence: "high" as const,
        isNew: true,
      },
    ];

    return knowledgeExtractionOutputSchema.parse(result);
  },
};
