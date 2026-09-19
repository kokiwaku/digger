import { z } from "zod";
import { articleAnalysisSchema } from "./llm/articleAnalysis.js";
import { conversationTurnSchema } from "./llm/conversation.js";
import { memoryExtractionInputSchema, type MemoryCandidate } from "./llm/memoryExtraction.js";
import { getMemoryExtractionService } from "./llm/memoryExtractionFactory.js";
import { relationToExistingSchema } from "./llm/knowledgeExtraction.js";
import { knowledgeSourceSchema } from "./knowledgeSource.js";
import { FIXED_USER_ID, getUserKnowledge, saveMultipleKnowledge, toUserKnowledge, type SaveKnowledgeInput } from "./knowledge.js";
import { linkConceptsForSavedKnowledge, type SavedKnowledgeOriginHint } from "./understandingStructure.js";
import {
  candidateMetadataSchema,
  getUserMemoryItems,
  knowledgeDocumentToMemoryItem,
  memoryItemDocumentToMemoryItem,
  memoryItemOriginSchema,
  memoryItemTypeSchema,
  saveMultipleMemoryItems,
  type MemoryItem,
  type MemoryItemType,
  type SaveMemoryItemInput,
} from "./memoryItem.js";
import type { UserKnowledge } from "./llm/personalizedAnalysis.js";

export const extractMemoryRequestSchema = z.object({
  source: knowledgeSourceSchema,
  articleAnalysis: articleAnalysisSchema,
  conversationHistory: z.array(conversationTurnSchema),
});
export type ExtractMemoryRequest = z.infer<typeof extractMemoryRequestSchema>;

export function parseExtractMemoryRequest(body: unknown): ExtractMemoryRequest {
  const result = extractMemoryRequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "invalid request");
  }
  return result.data;
}

// knowledge型のみ、既存Knowledge Extractionと同じ「理解がどう変わったか」の表示カテゴリを持つ。
// 他typeはtypeそのものでグルーピングするため不要（toDisplayCategoryはundefinedを返す）。
export type MemoryDisplayCategory = "new" | "deepened" | "updated";

export function toDisplayCategory(candidate: MemoryCandidate): MemoryDisplayCategory | undefined {
  if (candidate.type !== "knowledge") return undefined;
  switch (candidate.relationToExisting?.type) {
    case "extends":
      return "deepened";
    case "supersedes":
      return "updated";
    default:
      return "new";
  }
}

// reinforces（knowledgeが既存とほぼ同じ内容の再確認）は既存Knowledge Extractionと同様に除外する。
// low confidenceの候補は、type問わずUXを単純に保つため確認UIに出す前に除外する（#26）。
export function shouldShowForConfirmation(candidate: MemoryCandidate): boolean {
  if (candidate.relationToExisting?.type === "reinforces") return false;
  if (candidate.confidence === "low") return false;
  return true;
}

export type ConfirmationCandidate = MemoryCandidate & {
  displayCategory?: MemoryDisplayCategory;
  relatedKnowledge?: { concept: string; statement: string };
};

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

export async function buildMemoryExtractionResponse(
  request: ExtractMemoryRequest,
): Promise<{ candidates: ConfirmationCandidate[] }> {
  let existingKnowledge: UserKnowledge[] = [];
  try {
    const existingDocs = await getUserKnowledge();
    existingKnowledge = existingDocs.map(toUserKnowledge);
  } catch (err) {
    console.error("[memory/extract] failed to load existing knowledge, continuing without it", err);
  }

  const input = memoryExtractionInputSchema.parse({
    source: request.source,
    articleAnalysis: request.articleAnalysis,
    conversation: request.conversationHistory,
    existingKnowledge,
  });

  const service = getMemoryExtractionService();
  const result = await service.extract(input);

  const candidates: ConfirmationCandidate[] = result.candidates
    .filter(shouldShowForConfirmation)
    .map((candidate) => ({ ...candidate, displayCategory: toDisplayCategory(candidate) }));

  return { candidates: attachRelatedKnowledge(candidates, existingKnowledge) };
}

// 保存リクエスト1件分。AI候補をそのまま保存する場合(ai_extracted)・編集して保存する場合
// (user_edited)・ユーザーが「自分で追加」した場合(user_created)のいずれもこの形で受け取る
// （originはfrontend側が、AI候補を編集したかどうかを見て決定して送る）。
export const saveMemoryItemRequestSchema = z.object({
  id: z.string(),
  type: memoryItemTypeSchema,
  title: z.string().optional(),
  content: z.string().min(1),
  reason: z.string().optional(),
  metadata: candidateMetadataSchema.optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  origin: memoryItemOriginSchema,
  // knowledge型のみ、既存Knowledgeとの関係（Concept/Topicモデルへの反映・reinforces判定に使う）。
  relationToExisting: relationToExistingSchema.optional(),
});
export type SaveMemoryItemRequest = z.infer<typeof saveMemoryItemRequestSchema>;

export const saveMemoryRequestSchema = z.object({
  source: knowledgeSourceSchema,
  items: z.array(saveMemoryItemRequestSchema).min(1),
});
export type SaveMemoryRequest = z.infer<typeof saveMemoryRequestSchema>;

export function parseSaveMemoryRequest(body: unknown): SaveMemoryRequest {
  const result = saveMemoryRequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "invalid request");
  }
  return result.data;
}

// knowledge型は既存のKnowledge保存パイプライン（saveMultipleKnowledge +
// linkConceptsForSavedKnowledge）にそのまま委ねる。これにより、reinforcesスキップ・
// 重複判定・Concept/Topicモデルへの反映（Understanding Mapへの即時反映を含む）といった
// 既存の仕組みを一切変更・複製せずに再利用できる（Knowledgeだけが特別扱いされた構造を
// 壊さない、という方針にも合う）。preference/candidate/decision/open_questionは
// 新しいmemory_itemsコレクションへ保存する。
export async function saveMemoryItems(request: SaveMemoryRequest) {
  const knowledgeInputs: SaveKnowledgeInput[] = [];
  const otherInputs: SaveMemoryItemInput[] = [];

  for (const item of request.items) {
    if (item.type === "knowledge") {
      knowledgeInputs.push({
        concept: item.title?.trim() || item.content,
        statement: item.content,
        evidence: item.reason ?? "",
        confidence: item.confidence ?? "medium",
        source: request.source,
        relationToExisting: item.relationToExisting,
      });
    } else {
      otherInputs.push({
        type: item.type,
        title: item.title,
        content: item.content,
        metadata: item.metadata,
        confidence: item.confidence,
        source: request.source,
        origin: item.origin,
      });
    }
  }

  const [{ saved: savedKnowledge, skipped: skippedKnowledge }, { saved: savedOther, skipped: skippedOther }] =
    await Promise.all([
      knowledgeInputs.length > 0 ? saveMultipleKnowledge(knowledgeInputs) : Promise.resolve({ saved: [], skipped: [] }),
      otherInputs.length > 0 ? saveMultipleMemoryItems(otherInputs) : Promise.resolve({ saved: [], skipped: [] }),
    ]);

  // Concept/Topic Dig起点の最適化（起点ヒントによる即時Topic分類）と同じ経路に、
  // このMemory保存経由のknowledgeも通す（既存の/api/knowledge/saveと同じ挙動にするため）。
  if (savedKnowledge.length > 0) {
    const originHint: SavedKnowledgeOriginHint | undefined =
      request.source.type === "concept_dig"
        ? { type: "concept", conceptId: request.source.conceptId }
        : request.source.type === "topic_dig"
          ? { type: "topic", topicId: request.source.topicId }
          : undefined;
    try {
      await linkConceptsForSavedKnowledge(FIXED_USER_ID, savedKnowledge, originHint);
    } catch (err) {
      console.error("[memory/save] failed to link concepts/relations, continuing", err);
    }
  }

  const byType: Partial<Record<MemoryItemType, number>> = {};
  if (savedKnowledge.length > 0) byType.knowledge = savedKnowledge.length;
  for (const doc of savedOther) byType[doc.type] = (byType[doc.type] ?? 0) + 1;

  return {
    savedCount: savedKnowledge.length + savedOther.length,
    skippedCount: skippedKnowledge.length + skippedOther.length,
    byType,
  };
}

// GET /api/memory用。既存のuser_knowledgeコレクションと新しいmemory_itemsコレクションを
// 統一されたMemoryItem形へ変換して1つの一覧として返す（#18: 既存Knowledgeのadapter）。
export async function fetchMemoryItems(): Promise<MemoryItem[]> {
  const [knowledgeDocs, memoryDocs] = await Promise.all([getUserKnowledge(), getUserMemoryItems()]);
  const items = [
    ...knowledgeDocs.map(knowledgeDocumentToMemoryItem),
    ...memoryDocs.map(memoryItemDocumentToMemoryItem),
  ];
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
