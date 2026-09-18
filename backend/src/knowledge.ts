import { ObjectId } from "mongodb";
import { z } from "zod";
import { getMongoClient } from "./db.js";
import type { UserKnowledge } from "./llm/personalizedAnalysis.js";
import type { KnowledgeRelation } from "./llm/knowledgeExtraction.js";
import { getKnowledgeTopicService } from "./llm/knowledgeTopicFactory.js";
import { knowledgeSourceSchema, type KnowledgeSource } from "./knowledgeSource.js";

const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "digger";
const KNOWLEDGE_COLLECTION = "user_knowledge";

// 認証未実装のMVPのため、固定userIdで1ユーザー分のみを扱う。
export const FIXED_USER_ID = "local-user";

// Knowledgeは「不変のメモ」ではなく「現在の理解状態を構成する要素」として扱う。
// - active: 現在の理解として利用する
// - foundational: 十分理解され、暗黙の前提として扱える（今回は自動昇格しない。手動/将来実装向けの受け皿）
// - merged: より上位・包括的なKnowledgeへ統合された（今回は自動遷移しない）
// - outdated: 後から得た理解によって置き換えられた（今回は自動遷移しない）
// 既存データにstatusが無い場合は"active"として扱う（getEffectiveStatus参照）。
export const knowledgeStatusSchema = z.enum(["active", "foundational", "merged", "outdated"]);
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;

// 「自分の理解」ページのマップビュー用。reinforces/newは対象となる既存Knowledgeを持たないため、
// ここに保存されるのはextends/supersedesのみ（保存時にbuildRelationsOut()で構築）。
export const knowledgeRelationOutSchema = z.object({
  knowledgeId: z.string(),
  type: z.enum(["extends", "supersedes"]),
});
export type KnowledgeRelationOut = z.infer<typeof knowledgeRelationOutSchema>;

export const knowledgeDocumentSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  userId: z.string(),
  concept: z.string(),
  statement: z.string(),
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  // optional: 未設定の既存ドキュメントとの後方互換性のため。実際の扱いはgetEffectiveStatus()を通すこと。
  status: knowledgeStatusSchema.optional(),
  source: knowledgeSourceSchema,
  // Knowledge Extraction時にrelationToExistingが既存Knowledgeを指していた場合、その_idを記録する。
  // 今回はここに記録するだけで、自動統合（merged/outdatedへの変更等）は行わない。
  relatedKnowledgeIds: z.array(z.string()).optional(),
  // マップビューの辺（edge）用。relatedKnowledgeIdsと同じタイミングで設定されるが、
  // relation種別（extends/supersedes）も保持する。
  relationsOut: z.array(knowledgeRelationOutSchema).optional(),
  // 「自分の理解」ページのトピックビュー用。1〜3階層のパス（例:["経済","金融政策","政策金利"]）。
  // 未分類の既存ドキュメントとの後方互換性のためoptional（getUserKnowledgeWithTopics()が
  // 一覧取得時に未分類分だけ遅延分類してこのフィールドを埋める）。
  topicPath: z.array(z.string()).min(1).max(3).optional(),
  // Topic/Concept/Knowledgeモデル（understandingStructure.ts）用。concept文字列と併存し、
  // Concept entityへの参照を持つ。既存ドキュメントとの後方互換性のためoptional
  // （understandingStructure.tsのensureConceptsForKnowledge()が未設定分を遅延移行する）。
  conceptIds: z.array(z.string()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;

export function getEffectiveStatus(doc: Pick<KnowledgeDocument, "status">): KnowledgeStatus {
  return doc.status ?? "active";
}

// Deep DiveのRelevant Knowledge対象はactive/foundationalのみ（merged/outdatedは通常利用しない）。
// 既存データでstatus未設定のものはactive扱いとしてここに含める。
export function isEligibleForDeepDive(doc: Pick<KnowledgeDocument, "status">): boolean {
  const status = getEffectiveStatus(doc);
  return status === "active" || status === "foundational";
}

export function toUserKnowledge(doc: KnowledgeDocument): UserKnowledge {
  return {
    id: doc._id?.toHexString() ?? "",
    concept: doc.concept,
    statement: doc.statement,
    confidence: doc.confidence,
  };
}

export interface RelationToExistingInput {
  type: KnowledgeRelation;
  knowledgeId?: string;
  reason?: string;
}

export interface SaveKnowledgeInput {
  concept: string;
  statement: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
  source: KnowledgeSource;
  relationToExisting?: RelationToExistingInput;
}

// reinforcesは「既存Knowledgeとほぼ同じ理解を別の文脈から再確認しているだけ」なので、
// MVPでは新規保存をスキップできるようにする（extends/supersedes/newは通常どおり新規保存する）。
export function shouldSkipAsReinforcement(relationToExisting?: RelationToExistingInput): boolean {
  return relationToExisting?.type === "reinforces";
}

// relationToExistingが既存Knowledgeを指していれば、その_idをrelatedKnowledgeIdsとして
// 保存する（今回は参照を記録するだけで、既存Knowledge側の自動更新は行わない）。
export function buildRelatedKnowledgeIds(relationToExisting?: RelationToExistingInput): string[] | undefined {
  return relationToExisting?.knowledgeId ? [relationToExisting.knowledgeId] : undefined;
}

// マップビューの辺として保持する関係。new/reinforcesは対象Knowledgeを持たない
// （reinforcesはそもそも保存されない）ため、extends/supersedesのみを対象にする。
export function buildRelationsOut(relationToExisting?: RelationToExistingInput): KnowledgeRelationOut[] | undefined {
  if (!relationToExisting?.knowledgeId) return undefined;
  if (relationToExisting.type !== "extends" && relationToExisting.type !== "supersedes") return undefined;
  return [{ knowledgeId: relationToExisting.knowledgeId, type: relationToExisting.type }];
}

function getCollection() {
  return getMongoClient()
    .db(MONGODB_DB_NAME)
    .collection<Omit<KnowledgeDocument, "_id">>(KNOWLEDGE_COLLECTION);
}

// concept/statementの表記揺れ（空白・句読点・大文字小文字）をある程度吸収するための単純な正規化。
// Embedding等の高度な類似度判定はMVPのスコープ外（過剰な重複統合はしない）。
export function normalizeForDedup(text: string): string {
  return text.trim().toLowerCase().replace(/[\s、。,.!！?？「」『』]/g, "");
}

// 既存Knowledgeとconcept完全一致 + statement(正規化後)一致の場合のみ重複とみなす。
export async function isDuplicateKnowledge(
  userId: string,
  concept: string,
  statement: string,
): Promise<boolean> {
  const existing = await getCollection().find({ userId, concept }).toArray();
  const normalizedStatement = normalizeForDedup(statement);
  return existing.some((doc) => normalizeForDedup(doc.statement) === normalizedStatement);
}

// 選択されたcandidateのみをMVP固定userIdで保存する。既存Knowledgeとの重複（完全一致）や
// reinforces判定のものは無条件に保存せず、スキップとして扱う（呼び出し側が保存件数/
// スキップ件数を利用できる）。extends/supersedes/newは通常どおり新規Knowledgeとして保存する
// （supersedesでも、今回は既存Knowledgeを自動でoutdatedへ変更しない）。
export async function saveMultipleKnowledge(
  inputs: SaveKnowledgeInput[],
  userId: string = FIXED_USER_ID,
): Promise<{ saved: KnowledgeDocument[]; skipped: SaveKnowledgeInput[] }> {
  const collection = getCollection();
  const saved: KnowledgeDocument[] = [];
  const skipped: SaveKnowledgeInput[] = [];

  for (const input of inputs) {
    if (shouldSkipAsReinforcement(input.relationToExisting)) {
      skipped.push(input);
      continue;
    }

    if (await isDuplicateKnowledge(userId, input.concept, input.statement)) {
      skipped.push(input);
      continue;
    }

    const now = new Date();
    const relatedKnowledgeIds = buildRelatedKnowledgeIds(input.relationToExisting);
    const relationsOut = buildRelationsOut(input.relationToExisting);
    const doc: Omit<KnowledgeDocument, "_id"> = {
      userId,
      concept: input.concept,
      statement: input.statement,
      evidence: input.evidence,
      confidence: input.confidence,
      status: "active",
      source: input.source,
      ...(relatedKnowledgeIds ? { relatedKnowledgeIds } : {}),
      ...(relationsOut ? { relationsOut } : {}),
      // topicPathはここでは付与しない（一覧取得時にまとめて遅延分類する。assignTopicsToUnclassified参照）。
      createdAt: now,
      updatedAt: now,
    };

    const result = await collection.insertOne(doc);
    saved.push({ ...doc, _id: result.insertedId });
  }

  return { saved, skipped };
}

export async function getUserKnowledge(userId: string = FIXED_USER_ID): Promise<KnowledgeDocument[]> {
  return getCollection().find({ userId }).sort({ createdAt: -1 }).toArray();
}

// Deep DiveのRelevant Knowledge Retrievalに渡す対象（active/foundationalのみ）。
// Mongoクエリではなくアプリケーション側でフィルタする（isEligibleForDeepDive()を
// 単体テスト可能にするため。件数が少ない前提のMVPでは性能上の問題にならない）。
export async function getKnowledgeForDeepDive(userId: string = FIXED_USER_ID): Promise<KnowledgeDocument[]> {
  const all = await getUserKnowledge(userId);
  return all.filter(isEligibleForDeepDive);
}

// topicPathが未設定のKnowledgeだけをまとめて1回のLLM呼び出しで分類し、DBへ書き戻す
// （「毎回全KnowledgeをLLMへ送る」ことを避けるための遅延分類。一度分類されたKnowledgeは
// 次回以降このLLM呼び出し自体が発生しない）。分類に失敗しても例外を投げず、
// 未分類のまま（トピックビューでは「未分類」扱い）で一覧取得自体は継続できるようにする。
export async function assignTopicsToUnclassified(userId: string = FIXED_USER_ID): Promise<void> {
  const collection = getCollection();
  const unclassified = await collection.find({ userId, topicPath: { $exists: false } }).toArray();
  if (unclassified.length === 0) return;

  try {
    const classified = await collection.find({ userId, topicPath: { $exists: true } }).toArray();
    const existingTopicPaths = classified
      .map((doc) => doc.topicPath)
      .filter((path): path is string[] => Array.isArray(path) && path.length > 0);
    // 重複するpathを除いてprompt/コストを抑える。
    const uniqueExistingTopicPaths = Array.from(
      new Map(existingTopicPaths.map((path) => [path.join(" > "), path])).values(),
    );

    const service = getKnowledgeTopicService();
    const result = await service.classify({
      items: unclassified
        .filter((doc) => doc._id)
        .map((doc) => ({ id: doc._id!.toHexString(), concept: doc.concept, statement: doc.statement })),
      existingTopicPaths: uniqueExistingTopicPaths,
    });

    const pathById = new Map(result.assignments.map((a) => [a.id, a.path]));

    for (const doc of unclassified) {
      if (!doc._id) continue;
      const path = pathById.get(doc._id.toHexString());
      if (!path) continue;
      await collection.updateOne({ _id: doc._id }, { $set: { topicPath: path, updatedAt: new Date() } });
    }
  } catch (err) {
    console.error("[knowledge] failed to assign topics to unclassified knowledge, continuing without it", err);
  }
}

// 「自分の理解」ページ（GET /api/knowledge）から呼ぶ、topic分類込みの一覧取得。
export async function getUserKnowledgeWithTopics(userId: string = FIXED_USER_ID): Promise<KnowledgeDocument[]> {
  await assignTopicsToUnclassified(userId);
  return getUserKnowledge(userId);
}

// Topic/Concept/Knowledgeモデル（understandingStructure.ts）用のアクセサ。
// Mongoコレクションへのアクセスはknowledge.ts内に閉じておくため、更新用の薄いsetterと
// 単体取得用のgetterをここに用意する（understandingStructure.tsからknowledge.tsへの
// 一方向の依存のみにして、循環importを避ける）。
export async function getKnowledgeById(
  knowledgeId: string,
  userId: string = FIXED_USER_ID,
): Promise<KnowledgeDocument | null> {
  return getCollection().findOne({ _id: new ObjectId(knowledgeId), userId });
}

export async function setKnowledgeConceptIds(
  knowledgeId: string,
  conceptIds: string[],
  userId: string = FIXED_USER_ID,
): Promise<void> {
  await getCollection().updateOne(
    { _id: new ObjectId(knowledgeId), userId },
    { $set: { conceptIds, updatedAt: new Date() } },
  );
}
