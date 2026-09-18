// Knowledge（既存のconcept文字列ベースのモデル）と、新しいTopic/Concept/ConceptRelation
// モデルとの橋渡しを行うオーケストレーション層。将来の`UnderstandingStructureService`
// （Topic統合・分割・parent変更・ConceptのTopic移動などを提案・実行するservice）の
// 最初の一歩として、ここでは以下の最低限の責務のみを持つ:
//   - 既存Knowledgeのconcept文字列からConcept entityへのlazy migration
//   - Knowledgeのrelationsから対応するConceptRelationの生成
//   - ConceptのTopicへの分類（既存のKnowledge.topicPath分類とは別に、Concept単位で行う）
//   - 上記3つを束ねた「現在の理解構造」の取得（GET /api/understanding-mapの実体）
import { FIXED_USER_ID, getKnowledgeById, getUserKnowledge, setKnowledgeConceptIds, type KnowledgeDocument } from "./knowledge.js";
import { findOrCreateConcept, getUserConcepts, addTopicToConcept, type ConceptDocument } from "./concept.js";
import {
  createConceptRelation,
  getUserConceptRelations,
  isSelfRelation,
  type ConceptRelationDocument,
  type ConceptRelationType,
} from "./conceptRelation.js";
import { findOrCreateTopicPath, getUserTopics, buildTopicPathStrings, type TopicDocument } from "./topic.js";
import { getKnowledgeTopicService } from "./llm/knowledgeTopicFactory.js";

// KnowledgeのrelationsOut（extends/supersedes）を、Concept間の関係typeへ変換する。
// supersedesは「以前の理解を置き換える」に近いため、ConceptRelationのtypeとしては
// 対立・置き換えを表す"contrasts"に寄せる（relation typeを増やしすぎないための調整）。
export function mapKnowledgeRelationTypeToConceptRelationType(type: "extends" | "supersedes"): ConceptRelationType {
  return type === "extends" ? "extends" : "contrasts";
}

// conceptIds未設定のKnowledgeについて、concept文字列からConceptをfind-or-createし、
// conceptIdsをセットする（既存データのlazy migration。専用migrationスクリプトは作らず、
// topicPathの遅延分類と同じパターンを踏襲する）。
// あわせて、relationsOutを持つKnowledge（新規保存時にlinkConceptsForSavedKnowledge()で
// 同期されなかった既存データを含む）についてもConceptRelationを同期する。
// syncConceptRelationsFromKnowledge()自体がisDuplicateRelationで重複を防ぐため、
// 既に同期済みのKnowledgeに対して呼んでも安全（何度呼んでもConceptRelationは増えない）。
export async function ensureConceptsForKnowledge(userId: string = FIXED_USER_ID): Promise<void> {
  const allKnowledge = await getUserKnowledge(userId);
  const unlinked = allKnowledge.filter((doc) => !doc.conceptIds || doc.conceptIds.length === 0);

  for (const doc of unlinked) {
    if (!doc._id) continue;
    try {
      const concept = await findOrCreateConcept(userId, doc.concept);
      await setKnowledgeConceptIds(doc._id.toHexString(), [concept._id!.toHexString()], userId);
    } catch (err) {
      console.error("[understandingStructure] failed to link concept for knowledge, continuing", err);
    }
  }

  const withRelations = allKnowledge.filter((doc) => doc.relationsOut && doc.relationsOut.length > 0);
  for (const doc of withRelations) {
    await syncConceptRelationsFromKnowledge(userId, doc);
  }
}

// 保存済みKnowledgeのrelationsOutから、対応するConceptRelationを作成する。
// 参照先Knowledgeが見つからない、あるいはConcept作成/関係作成に失敗しても、
// 呼び出し元（Knowledge保存フロー）を止めないようbest-effortで扱う。
export async function syncConceptRelationsFromKnowledge(userId: string, savedDoc: KnowledgeDocument): Promise<void> {
  if (!savedDoc.relationsOut || savedDoc.relationsOut.length === 0) return;

  for (const relation of savedDoc.relationsOut) {
    try {
      const targetDoc = await getKnowledgeById(relation.knowledgeId, userId);
      if (!targetDoc) continue;

      const fromConcept = await findOrCreateConcept(userId, savedDoc.concept);
      const toConcept = await findOrCreateConcept(userId, targetDoc.concept);
      const fromId = fromConcept._id!.toHexString();
      const toId = toConcept._id!.toHexString();
      if (isSelfRelation(fromId, toId)) continue;

      await createConceptRelation(userId, {
        fromConceptId: fromId,
        toConceptId: toId,
        type: mapKnowledgeRelationTypeToConceptRelationType(relation.type),
      });
    } catch (err) {
      console.error("[understandingStructure] failed to sync concept relation, continuing", err);
    }
  }
}

// Knowledge保存直後の「軽量更新」: 新しく保存されたKnowledgeそれぞれについて、
// Conceptへの紐付けとConceptRelationの生成を行う。LLMを使うTopic分類（重い処理）は
// ここでは行わず、assignTopicsToUnclassifiedConcepts()（GET /api/understanding-map経由の
// 「深い再構成」）に委ねる。
export async function linkConceptsForSavedKnowledge(userId: string, savedDocs: KnowledgeDocument[]): Promise<void> {
  for (const doc of savedDocs) {
    if (!doc._id) continue;
    try {
      const concept = await findOrCreateConcept(userId, doc.concept);
      await setKnowledgeConceptIds(doc._id.toHexString(), [concept._id!.toHexString()], userId);
      await syncConceptRelationsFromKnowledge(userId, doc);
    } catch (err) {
      console.error("[understandingStructure] failed to link concept/relations for saved knowledge, continuing", err);
    }
  }
}

// topicIdsが空のConceptだけをまとめて1回のLLM呼び出しで分類する（毎回全ConceptをLLMへ
// 送らないための遅延分類。既存のknowledge.tsのassignTopicsToUnclassified()と同じ
// knowledgeTopicServiceを共用するが、対象と永続化先がConcept/Topicモデルである点が異なる）。
export async function assignTopicsToUnclassifiedConcepts(userId: string = FIXED_USER_ID): Promise<void> {
  const concepts = await getUserConcepts(userId);
  const unclassified = concepts.filter((c) => c.status === "active" && c.topicIds.length === 0);
  if (unclassified.length === 0) return;

  try {
    const topics = await getUserTopics(userId);
    const existingTopicPaths = buildTopicPathStrings(
      topics.map((t) => ({ id: t._id!.toHexString(), parentId: t.parentId ?? null, name: t.name, status: t.status })),
    );

    const knowledgeDocs = await getUserKnowledge(userId);
    const statementByConceptId = new Map<string, string>();
    for (const doc of knowledgeDocs) {
      for (const conceptId of doc.conceptIds ?? []) {
        if (!statementByConceptId.has(conceptId)) statementByConceptId.set(conceptId, doc.statement);
      }
    }

    const service = getKnowledgeTopicService();
    const result = await service.classify({
      items: unclassified.map((c) => ({
        id: c._id!.toHexString(),
        concept: c.name,
        statement: statementByConceptId.get(c._id!.toHexString()) ?? c.name,
      })),
      existingTopicPaths,
    });

    for (const assignment of result.assignments) {
      const chain = await findOrCreateTopicPath(userId, assignment.path);
      const leaf = chain[chain.length - 1];
      if (leaf?._id) {
        await addTopicToConcept(userId, assignment.id, leaf._id.toHexString());
      }
    }
  } catch (err) {
    console.error("[understandingStructure] failed to assign topics to unclassified concepts, continuing", err);
  }
}

export interface UnderstandingMap {
  topics: TopicDocument[];
  concepts: ConceptDocument[];
  relations: ConceptRelationDocument[];
}

// GET /api/understanding-mapの実体。「現在の理解構造」をTopic階層・Concept・
// ConceptRelationとして返す。呼ばれるたびに、未移行のKnowledge/未分類のConceptがあれば
// 先に埋めてから返す（lazy migration + lazy classification）。
export async function getUnderstandingMap(userId: string = FIXED_USER_ID): Promise<UnderstandingMap> {
  await ensureConceptsForKnowledge(userId);
  await assignTopicsToUnclassifiedConcepts(userId);

  const [topics, concepts, relations] = await Promise.all([
    getUserTopics(userId),
    getUserConcepts(userId),
    getUserConceptRelations(userId),
  ]);

  return { topics, concepts, relations };
}
