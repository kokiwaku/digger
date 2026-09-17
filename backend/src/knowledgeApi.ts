import { z } from "zod";
import { articleAnalysisSchema } from "./llm/articleAnalysis.js";
import { conversationTurnSchema } from "./llm/conversation.js";
import {
  knowledgeCandidateSchema,
  knowledgeExtractionInputSchema,
  knowledgeSourceSchema,
  type KnowledgeExtractionResult,
} from "./llm/knowledgeExtraction.js";
import { getKnowledgeExtractionService } from "./llm/knowledgeExtractionFactory.js";
import { getUserKnowledge, saveMultipleKnowledge, toUserKnowledge, type SaveKnowledgeInput } from "./knowledge.js";
import type { UserKnowledge } from "./llm/personalizedAnalysis.js";

export const extractKnowledgeRequestSchema = z.object({
  source: knowledgeSourceSchema,
  articleAnalysis: articleAnalysisSchema,
  conversationHistory: z.array(conversationTurnSchema),
});
export type ExtractKnowledgeRequest = z.infer<typeof extractKnowledgeRequestSchema>;

export function parseExtractKnowledgeRequest(body: unknown): ExtractKnowledgeRequest {
  const result = extractKnowledgeRequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "invalid request");
  }
  return result.data;
}

// low confidenceの候補はUXをシンプルに保つため確認UIには出さない（MVP判断。
// evidenceはユーザーへの常時表示はしないが、レスポンスには含めておき将来のUIで使えるようにする）。
export function filterForConfirmationUi(result: KnowledgeExtractionResult): KnowledgeExtractionResult {
  return { candidates: result.candidates.filter((candidate) => candidate.confidence !== "low") };
}

export async function buildKnowledgeExtractionResponse(
  request: ExtractKnowledgeRequest,
): Promise<KnowledgeExtractionResult> {
  // 既存KnowledgeはisNew判定の参考情報に過ぎないため、取得に失敗しても抽出自体は続行する。
  let existingKnowledge: UserKnowledge[] = [];
  try {
    const existingDocs = await getUserKnowledge();
    existingKnowledge = existingDocs.map(toUserKnowledge);
  } catch (err) {
    console.error("[knowledge/extract] failed to load existing knowledge, continuing without it", err);
  }

  const input = knowledgeExtractionInputSchema.parse({
    source: request.source,
    articleAnalysis: request.articleAnalysis,
    conversation: request.conversationHistory,
    existingKnowledge,
  });

  const service = getKnowledgeExtractionService();
  const result = await service.extract(input);

  return filterForConfirmationUi(result);
}

export const saveKnowledgeRequestSchema = z.object({
  source: knowledgeSourceSchema,
  candidates: z.array(knowledgeCandidateSchema).min(1),
});
export type SaveKnowledgeRequest = z.infer<typeof saveKnowledgeRequestSchema>;

export function parseSaveKnowledgeRequest(body: unknown): SaveKnowledgeRequest {
  const result = saveKnowledgeRequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "invalid request");
  }
  return result.data;
}

export async function saveCandidatesAsKnowledge(request: SaveKnowledgeRequest) {
  const saveInputs: SaveKnowledgeInput[] = request.candidates.map((candidate) => ({
    concept: candidate.concept,
    statement: candidate.statement,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    source: request.source,
    relationToExisting: candidate.relationToExisting,
  }));

  const { saved, skipped } = await saveMultipleKnowledge(saveInputs);
  return {
    savedCount: saved.length,
    skippedCount: skipped.length,
  };
}

export async function fetchUserKnowledge() {
  return getUserKnowledge();
}
