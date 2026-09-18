import { z } from "zod";
import { articleAnalysisSchema } from "./articleAnalysis.js";
import { conversationTurnSchema } from "./conversation.js";
import { userKnowledgeSchema } from "./personalizedAnalysis.js";
import { knowledgeSourceSchema } from "../knowledgeSource.js";

// Knowledge Extraction: ユーザーが記事について深掘りした後の対話から、
// 「今回新しく理解したと思われること」の保存"候補"を抽出する処理。
// AIがユーザーの理解を勝手に確定してはいけないため、出力はあくまで候補であり、
// 最終的にユーザーが確認して保存するかどうかを決める（保存は knowledgeRepository.ts が担当）。

export { knowledgeSourceSchema } from "../knowledgeSource.js";
export type { KnowledgeSource } from "../knowledgeSource.js";

export const knowledgeExtractionInputSchema = z.object({
  source: knowledgeSourceSchema,
  articleAnalysis: articleAnalysisSchema,
  // 深掘りセッション（ユーザーとAIのやり取り）のログ。ここから理解の痕跡を拾う。
  conversation: z.array(conversationTurnSchema),
  // ユーザーが過去に保存した理解。重複判定(isNew)の参考情報として渡す（未指定でも動作する）。
  existingKnowledge: z.array(userKnowledgeSchema).optional(),
});
export type KnowledgeExtractionInput = z.infer<typeof knowledgeExtractionInputSchema>;

// 新しいcandidateが既存Knowledgeに対してどういう関係にあるか。
// - new: 既存Knowledgeにはない新しい理解
// - reinforces: 既存Knowledgeとほぼ同じ理解を、別の文脈から再確認・強化している（表現違いレベル）
// - extends: 既存Knowledgeを前提として、さらに理解が広がっている
// - supersedes: 既存Knowledgeの内容が不正確または古く、今回の理解で置き換えるべき
// 今回はこの関係を判定・保持するところまでで、自動でのKnowledge統合（merged/outdatedへの
// 変更やstatement書き換え等）は行わない。
export const knowledgeRelationSchema = z.enum(["new", "reinforces", "extends", "supersedes"]);
export type KnowledgeRelation = z.infer<typeof knowledgeRelationSchema>;

export const relationToExistingSchema = z.object({
  type: knowledgeRelationSchema,
  // 対応する既存Knowledgeのid（existingKnowledgeのUserKnowledge.id）。無理に紐付けられない場合は省略可。
  knowledgeId: z.string().optional(),
  reason: z.string().optional(),
});
export type RelationToExisting = z.infer<typeof relationToExistingSchema>;

// LLMが実際に生成する候補の形。idはLLMに生成させず、サービス側でrandomUUID()を付与する
// （一意性をLLMの出力に依存させないため）。
export const knowledgeCandidateDraftSchema = z.object({
  concept: z.string(),
  statement: z.string(),
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  isNew: z.boolean(),
  // 既存Knowledgeと意味的な関係がある場合のみ設定する。関連がなければ省略してよい。
  relationToExisting: relationToExistingSchema.optional(),
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
