// Knowledge（既存のconcept文字列ベースのモデル）と、新しいTopic/Concept/ConceptRelation
// モデルとの橋渡しを行うオーケストレーション層。将来の`UnderstandingStructureService`
// （Topic統合・分割・parent変更・ConceptのTopic移動などを提案・実行するservice）の
// 最初の一歩として、ここでは以下の最低限の責務のみを持つ:
//   - 既存Knowledgeのconcept文字列からConcept entityへのlazy migration
//   - Knowledgeのrelationsから対応するConceptRelationの生成
//   - ConceptのTopicへの分類（既存のKnowledge.topicPath分類とは別に、Concept単位で行う）
//   - 上記3つを束ねた「現在の理解構造」の取得（GET /api/understanding-mapの実体）
import { FIXED_USER_ID, getKnowledgeById, getUserKnowledge, setKnowledgeConceptIds, type KnowledgeDocument } from "./knowledge.js";
import {
  findOrCreateConcept,
  getConceptById,
  getUserConcepts,
  addTopicToConcept,
  type ConceptDocument,
} from "./concept.js";
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
// supersedes（既存の理解を置き換える）はcontrasts（対比・対立）とは意味が異なるため、
// 情報を失わないようConceptRelationTypeにもsupersedesをそのまま残す（恒等変換）。
export function mapKnowledgeRelationTypeToConceptRelationType(type: "extends" | "supersedes"): ConceptRelationType {
  return type;
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
//
// あわせて、Concept/Topic Dig起点のoriginHintと同じ思想で、LLM呼び出しなしのTopic推定も行う:
// 新しいKnowledgeが既存Knowledgeを「extends/supersedes」している（＝関連が明確）場合、
// 関連先ConceptがすでにTopic分類済みならそのTopicを継承する。「このKnowledgeは既存の理解と
// 明確に関係がある」というのはLLMのKnowledge Extraction自体が既に判定済みの情報なので、
// ここでさらにLLMを呼ばなくても「既存のTopicに近い」と推定できる、という考え方。
// 単なる`reinforces`（既存と同じConceptの再確認）はfindOrCreateConceptが同一Conceptを
// 返すため、この関数を通らずとも自動的にtopicIdsを引き継いでいる。
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

      if (fromConcept.topicIds.length === 0 && toConcept.topicIds.length > 0) {
        for (const topicId of toConcept.topicIds) {
          await addTopicToConcept(userId, fromId, topicId);
        }
      }
    } catch (err) {
      console.error("[understandingStructure] failed to sync concept relation, continuing", err);
    }
  }
}

// Concept/Topic Digから保存されたKnowledgeについて、起点のConcept/Topicを伝える。
// 「田沢梨乃容疑者について掘る」で新しいConcept（例:「コカイン所持」）が生まれた場合、
// それがどのTopicに属するかはLLMに聞かなくても自明（起点と同じTopic）なので、
// この情報をlinkConceptsForSavedKnowledge()に渡し、重いLLM分類（
// assignTopicsToUnclassifiedConcepts()）を待たずに即座にTopic階層へ反映させる。
export type SavedKnowledgeOriginHint =
  | { type: "concept"; conceptId: string }
  | { type: "topic"; topicId: string };

// originHintから「新しく作られたConceptに直接付けるべきtopicId一覧」を解決する。
// concept起点の場合、起点Concept自身がまだ未分類（topicIds空）なら継承先が無いため
// 空配列を返す（無理にLLM相当の推測をしない。その場合は従来通りlazy classification任せ）。
async function resolveOriginTopicIds(userId: string, originHint: SavedKnowledgeOriginHint): Promise<string[]> {
  if (originHint.type === "topic") return [originHint.topicId];
  const originConcept = await getConceptById(userId, originHint.conceptId);
  return originConcept?.topicIds ?? [];
}

// Knowledge保存直後の「軽量更新」: 新しく保存されたKnowledgeそれぞれについて、
// Conceptへの紐付けとConceptRelationの生成を行う。LLMを使うTopic分類（重い処理）は
// 通常ここでは行わず、assignTopicsToUnclassifiedConcepts()（GET /api/understanding-map経由の
// 「深い再構成」）に委ねる。ただしoriginHint（Concept/Topic Dig起点）があり、かつ
// 新しく作られた（＝まだtopicIdsが空の）Conceptについては、起点から自明なTopicを
// その場で直接付与し、LLM分類を待たずにMapへ反映させる。
export async function linkConceptsForSavedKnowledge(
  userId: string,
  savedDocs: KnowledgeDocument[],
  originHint?: SavedKnowledgeOriginHint,
): Promise<void> {
  const originTopicIds = originHint ? await resolveOriginTopicIds(userId, originHint) : [];

  for (const doc of savedDocs) {
    if (!doc._id) continue;
    try {
      const concept = await findOrCreateConcept(userId, doc.concept);
      await setKnowledgeConceptIds(doc._id.toHexString(), [concept._id!.toHexString()], userId);
      await syncConceptRelationsFromKnowledge(userId, doc);

      // syncConceptRelationsFromKnowledge()が関連Conceptからのtopic推定で既に
      // topicIdsを埋めている可能性があるため、その結果を踏まえて再取得してから判定する
      // （関連からの推定 > originHintによる推定、の優先度。両方満たしても実害は無いが
      // 無駄なDB書き込みを避けるため）。
      if (originTopicIds.length > 0 && concept._id) {
        const refreshed = await getConceptById(userId, concept._id.toHexString());
        if (refreshed && refreshed.topicIds.length === 0) {
          for (const topicId of originTopicIds) {
            await addTopicToConcept(userId, concept._id.toHexString(), topicId);
          }
        }
      }
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
// ConceptRelationとして、既存のDBの状態をそのまま読むだけの純粋な読み取り。
// GETは副作用（lazy migrationやLLM呼び出し）を一切行わない
// （読むだけのはずのAPIが「開いただけで重い処理」を引き起こすのを避けるため。
// Conceptが増えるほどassignTopicsToUnclassifiedConcepts()のLLM呼び出しは重くなり、
// 実際に25件程度でもVertex AIの30秒タイムアウトに達することがあった）。
// migration/分類を進めたい場合はrefreshUnderstandingMap()を明示的に呼ぶ。
export async function getUnderstandingMap(userId: string = FIXED_USER_ID): Promise<UnderstandingMap> {
  const [topics, concepts, relations] = await Promise.all([
    getUserTopics(userId),
    getUserConcepts(userId),
    getUserConceptRelations(userId),
  ]);

  return { topics, concepts, relations };
}

// POST /api/understanding-map/refreshの実体。未移行のKnowledge（lazy migration）と
// 未分類のConcept（lazy classification、LLM呼び出しを伴う）を明示的に処理してから、
// 更新後の理解構造を返す。GETとは違い、これは呼び出し側が「重い処理が起きる」ことを
// 理解した上で明示的に叩くエンドポイントである。
export async function refreshUnderstandingMap(userId: string = FIXED_USER_ID): Promise<UnderstandingMap> {
  await ensureConceptsForKnowledge(userId);
  await assignTopicsToUnclassifiedConcepts(userId);
  return getUnderstandingMap(userId);
}
