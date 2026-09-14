import { z } from "zod";
import { articleAnalysisSchema } from "./articleAnalysis.js";
import { conversationTurnSchema } from "./conversation.js";

// Knowledge Extraction: ユーザーが記事について深掘りした後の対話から、
// 「今回新しく理解したと思われること」の保存"候補"を抽出する処理。
// AIがユーザーの理解を勝手に確定してはいけないため、出力はあくまで候補であり、
// 最終的にユーザーが確認して保存するかどうかを決める想定（保存自体は今回未実装）。

export const knowledgeExtractionInputSchema = z.object({
  articleAnalysis: articleAnalysisSchema,
  // 深掘りセッション（ユーザーとAIのやり取り）のログ。ここから理解の痕跡を拾う。
  conversation: z.array(conversationTurnSchema),
});
export type KnowledgeExtractionInput = z.infer<typeof knowledgeExtractionInputSchema>;

export const knowledgeCandidateSchema = z.object({
  concept: z.string(),
  statement: z.string(),
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  isNew: z.boolean(),
});
export type KnowledgeCandidate = z.infer<typeof knowledgeCandidateSchema>;

export const knowledgeExtractionOutputSchema = z.array(knowledgeCandidateSchema);
export type KnowledgeExtractionOutput = z.infer<typeof knowledgeExtractionOutputSchema>;

export interface KnowledgeExtractionService {
  extract(input: KnowledgeExtractionInput): Promise<KnowledgeExtractionOutput>;
}
