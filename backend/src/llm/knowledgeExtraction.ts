import { z } from "zod";
import { articleAnalysisSchema } from "./articleAnalysis.js";
import { conversationTurnSchema } from "./conversation.js";
import { userKnowledgeSchema } from "./personalizedAnalysis.js";

// Knowledge Extraction: ユーザーが記事について深掘りした後の対話から、
// 「今回新しく理解したと思われること」の保存"候補"を抽出する処理。
// AIがユーザーの理解を勝手に確定してはいけないため、出力はあくまで候補であり、
// 最終的にユーザーが確認して保存するかどうかを決める（保存は knowledgeRepository.ts が担当）。

export const knowledgeSourceSchema = z.object({
  type: z.literal("web_article"),
  url: z.string(),
  title: z.string(),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

export const knowledgeExtractionInputSchema = z.object({
  source: knowledgeSourceSchema,
  articleAnalysis: articleAnalysisSchema,
  // 深掘りセッション（ユーザーとAIのやり取り）のログ。ここから理解の痕跡を拾う。
  conversation: z.array(conversationTurnSchema),
  // ユーザーが過去に保存した理解。重複判定(isNew)の参考情報として渡す（未指定でも動作する）。
  existingKnowledge: z.array(userKnowledgeSchema).optional(),
});
export type KnowledgeExtractionInput = z.infer<typeof knowledgeExtractionInputSchema>;

// LLMが実際に生成する候補の形。idはLLMに生成させず、サービス側でrandomUUID()を付与する
// （一意性をLLMの出力に依存させないため）。
export const knowledgeCandidateDraftSchema = z.object({
  concept: z.string(),
  statement: z.string(),
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  isNew: z.boolean(),
});
export type KnowledgeCandidateDraft = z.infer<typeof knowledgeCandidateDraftSchema>;

export const knowledgeCandidateSchema = knowledgeCandidateDraftSchema.extend({
  id: z.string(),
});
export type KnowledgeCandidate = z.infer<typeof knowledgeCandidateSchema>;

// LLMへ要求するJSON schema用（idを含まない）。
export const knowledgeExtractionDraftSchema = z.object({
  candidates: z.array(knowledgeCandidateDraftSchema),
});
export type KnowledgeExtractionDraft = z.infer<typeof knowledgeExtractionDraftSchema>;

// サービスの最終的な戻り値（idを含む）。APIレスポンスもこの形。
export const knowledgeExtractionResultSchema = z.object({
  candidates: z.array(knowledgeCandidateSchema),
});
export type KnowledgeExtractionResult = z.infer<typeof knowledgeExtractionResultSchema>;

export interface KnowledgeExtractionService {
  extract(input: KnowledgeExtractionInput): Promise<KnowledgeExtractionResult>;
}
