import { z } from "zod";
import { articleAnalysisSchema } from "./articleAnalysis.js";
import { conversationTurnSchema } from "./conversation.js";
import { userKnowledgeSchema } from "./personalizedAnalysis.js";
import { knowledgeSourceSchema } from "../knowledgeSource.js";
import { knowledgeRelationSchema, relationToExistingSchema } from "./knowledgeExtraction.js";
import { candidateMetadataSchema, memoryItemTypeSchema } from "../memoryItem.js";

// Memory Extraction: 既存のKnowledge Extractionを、保存対象がKnowledgeだけに限定されない
// より一般的な形へ広げたもの。Deep Dive会話から、
// 「理解したこと(knowledge)」「条件・好み(preference)」「検討候補(candidate)」
// 「決めたこと(decision)」「まだ未解決のこと(open_question)」の"候補"を抽出する。
// Knowledge Extractionと同様、AIは候補を出すだけで確定はしない
// （最終的にユーザーが選ぶ・編集する・自分で追加する）。

export { knowledgeSourceSchema } from "../knowledgeSource.js";
export type { KnowledgeSource } from "../knowledgeSource.js";
export { memoryItemTypeSchema } from "../memoryItem.js";
export type { MemoryItemType, CandidateMetadata } from "../memoryItem.js";

export const memoryExtractionInputSchema = z.object({
  source: knowledgeSourceSchema,
  articleAnalysis: articleAnalysisSchema,
  conversation: z.array(conversationTurnSchema),
  // knowledge候補のisNew/relationToExisting判定の参考情報。既存の重複判定・
  // Concept/Topicへの反映（understandingStructure.ts）はknowledge型のみに関わるため、
  // preference/candidate/decision/open_questionにはこの情報を使わない（今回はスコープ外）。
  existingKnowledge: z.array(userKnowledgeSchema).optional(),
});
export type MemoryExtractionInput = z.infer<typeof memoryExtractionInputSchema>;

// LLMが実際に生成する候補の形。idはLLMに生成させず、サービス側でrandomUUID()を付与する。
export const memoryCandidateDraftSchema = z.object({
  type: memoryItemTypeSchema,
  // knowledgeは短い概念名（例:「政策金利」）、candidateは検討対象名（例:「トヨタ RAV4」）を想定。
  // preference/decision/open_questionは省略されることが多い。
  title: z.string().optional(),
  content: z.string(),
  // なぜこれを候補にしたか（会話中の具体的な根拠）。ユーザーには常時表示しないが、
  // evidence相当の内部情報として保持する。knowledgeのevidenceはこのフィールドに統一する。
  reason: z.string().optional(),
  // candidate専用（reasons/concerns/status）。他typeでは省略される。
  metadata: candidateMetadataSchema.optional(),
  confidence: z.enum(["low", "medium", "high"]),
  // knowledge型の場合のみ設定してよい。他の型では省略する
  // （preference/candidate/decisionは「新規に残すか・重複か」の判定を今回は行わない）。
  relationToExisting: relationToExistingSchema.optional(),
});
export type MemoryCandidateDraft = z.infer<typeof memoryCandidateDraftSchema>;

export const memoryCandidateSchema = memoryCandidateDraftSchema.extend({
  id: z.string(),
});
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;

export const memoryExtractionDraftSchema = z.object({
  candidates: z.array(memoryCandidateDraftSchema),
});
export type MemoryExtractionDraft = z.infer<typeof memoryExtractionDraftSchema>;

export const memoryExtractionResultSchema = z.object({
  candidates: z.array(memoryCandidateSchema),
});
export type MemoryExtractionResult = z.infer<typeof memoryExtractionResultSchema>;

export interface MemoryExtractionService {
  extract(input: MemoryExtractionInput): Promise<MemoryExtractionResult>;
}

export { knowledgeRelationSchema, relationToExistingSchema };
