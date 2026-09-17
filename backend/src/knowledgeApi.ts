import { z } from "zod";
import { articleAnalysisSchema } from "./llm/articleAnalysis.js";
import { conversationTurnSchema } from "./llm/conversation.js";
import {
  knowledgeCandidateSchema,
  knowledgeExtractionInputSchema,
  knowledgeSourceSchema,
  type KnowledgeCandidate,
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

// Diggerは「Knowledgeを増やすこと」ではなく「理解状態がどう変化したか」を見せたいので、
// LLMが判定したrelationToExisting（生のenum）をそのままUIに出さず、表示用のカテゴリに変換する。
// - new / relationToExisting未設定 → "new"（新しくわかったこと）
// - extends → "deepened"（理解が深まったこと）
// - supersedes → "updated"（理解を更新するもの）
// - reinforces相当はshouldShowForConfirmation()でそもそも除外されるため、ここには来ない想定。
export type KnowledgeDisplayCategory = "new" | "deepened" | "updated";

export function toDisplayCategory(candidate: KnowledgeCandidate): KnowledgeDisplayCategory {
  switch (candidate.relationToExisting?.type) {
    case "extends":
      return "deepened";
    case "supersedes":
      return "updated";
    default:
      return "new";
  }
}

// reinforcesは「既に理解している内容を、別の文脈で再確認しただけ」なので、
// 保存候補一覧には原則表示しない（「すでに理解しているのに、なぜ保存するのか」がユーザーから
// 分かりにくいため）。将来的にreinforceCount/lastReinforcedAt/confidence補強等に使う余地を
// 残すため、LLMの出力自体からは削らずAPI応答の時点でフィルタする。
export function shouldShowForConfirmation(candidate: KnowledgeCandidate): boolean {
  return candidate.relationToExisting?.type !== "reinforces";
}

export type ConfirmationCandidate = KnowledgeCandidate & {
  displayCategory: KnowledgeDisplayCategory;
  // extends/supersedesの場合、参照先の既存Knowledgeの内容（UI表示用）。
  // 「以前の『◯◯』から理解が深まりました」「以前の理解 / 今回の理解」のような表示に使う。
  relatedKnowledge?: { concept: string; statement: string };
};

export type ConfirmationResult = { candidates: ConfirmationCandidate[] };

// relationToExisting.knowledgeIdが指す既存Knowledgeの内容をUI表示用に付与する。
// 一致するものが見つからない場合は付与しない（無理に表示しない）。
export function attachRelatedKnowledge(
  candidates: ConfirmationCandidate[],
  existingKnowledge: UserKnowledge[],
): ConfirmationCandidate[] {
  const byId = new Map(existingKnowledge.map((k) => [k.id, k]));

  return candidates.map((candidate) => {
    const knowledgeId = candidate.relationToExisting?.knowledgeId;
    const related = knowledgeId ? byId.get(knowledgeId) : undefined;
    if (!related) return candidate;
    return { ...candidate, relatedKnowledge: { concept: related.concept, statement: related.statement } };
  });
}

// low confidenceの候補はUXをシンプルに保つため確認UIには出さない（MVP判断。
// evidenceはユーザーへの常時表示はしないが、レスポンスには含めておき将来のUIで使えるようにする）。
// reinforcesも同じ理由で確認UIからは除外し、残った候補にはUI表示用のdisplayCategoryを付与する。
export function filterForConfirmationUi(result: KnowledgeExtractionResult): ConfirmationResult {
  const candidates = result.candidates
    .filter((candidate) => candidate.confidence !== "low")
    .filter(shouldShowForConfirmation)
    .map((candidate) => ({ ...candidate, displayCategory: toDisplayCategory(candidate) }));

  return { candidates };
}

export async function buildKnowledgeExtractionResponse(
  request: ExtractKnowledgeRequest,
): Promise<ConfirmationResult> {
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

  const confirmation = filterForConfirmationUi(result);
  return { candidates: attachRelatedKnowledge(confirmation.candidates, existingKnowledge) };
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
