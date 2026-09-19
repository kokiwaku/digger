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
import {
  FIXED_USER_ID,
  getUserKnowledge,
  getUserKnowledgeWithTopics,
  saveMultipleKnowledge,
  toUserKnowledge,
  type SaveKnowledgeInput,
} from "./knowledge.js";
import {
  getUnderstandingMap,
  linkConceptsForSavedKnowledge,
  refreshUnderstandingMap,
  type SavedKnowledgeOriginHint,
} from "./understandingStructure.js";
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

  // Concept/Topic Dig（自分の理解画面から起点Concept/Topicを指定して掘ったセッション）
  // からの保存なら、新しく生まれたConceptがどのTopicに属すかは起点から自明なので、
  // LLMによる分類を待たずに直接反映できるようヒントとして渡す（詳細はunderstandingStructure.ts参照）。
  const originHint: SavedKnowledgeOriginHint | undefined =
    request.source.type === "concept_dig"
      ? { type: "concept", conceptId: request.source.conceptId }
      : request.source.type === "topic_dig"
        ? { type: "topic", topicId: request.source.topicId }
        : undefined;

  // Topic/Concept/Knowledgeモデル（understandingStructure.ts）への「軽量更新」。
  // Concept作成・紐付け・ConceptRelation生成はDB書き込みのみで完結する軽い処理のため、
  // ここで同期的に行う（LLMによるTopic分類は通常行わない。それはGET /api/understanding-map
  // 側の「深い再構成」に委ねる。ただしoriginHintがある場合はその場で直接分類する）。
  // 失敗してもKnowledge本体の保存結果には影響させない。
  try {
    await linkConceptsForSavedKnowledge(FIXED_USER_ID, saved, originHint);
  } catch (err) {
    console.error("[knowledge/save] failed to link concepts/relations, continuing", err);
  }

  return {
    savedCount: saved.length,
    skippedCount: skipped.length,
  };
}

// 「自分の理解」ページ（GET /api/knowledge）用。未分類のKnowledgeがあれば、
// 一覧取得時にまとめて1回だけtopicPathを遅延分類してから返す。
export async function fetchUserKnowledge() {
  return getUserKnowledgeWithTopics();
}

// GET /api/understanding-map用。既存のGET /api/knowledgeとは別に、新しい
// Topic/Concept/ConceptRelationモデルを返す。読み取り専用で、lazy migrationや
// LLMによるTopic分類などの副作用は一切行わない（副作用はrefreshUnderstandingMap参照）。
export async function fetchUnderstandingMap() {
  return getUnderstandingMap();
}

// POST /api/understanding-map/refresh用。未移行のKnowledgeのConceptへの変換と、
// 未分類のConceptのTopic分類（LLM呼び出しを伴う）を明示的に実行してから、
// 更新後のTopic/Concept/ConceptRelationを返す。
export async function refreshAndFetchUnderstandingMap() {
  return refreshUnderstandingMap();
}
