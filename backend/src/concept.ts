import { ObjectId } from "mongodb";
import { z } from "zod";
import { getMongoClient } from "./db.js";

const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "digger";
const CONCEPT_COLLECTION = "user_concepts";

// Conceptは「ユーザーが具体的に理解している対象」（例: MI6、政策金利）。
// Topic（俯瞰用の粗い分類）とは役割を分ける。Map上では基本的にConceptがnodeになる想定。
export const conceptStatusSchema = z.enum(["active", "merged", "archived"]);
export type ConceptStatus = z.infer<typeof conceptStatusSchema>;

export const conceptDocumentSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  userId: z.string(),
  name: z.string().min(1),
  // 1つのConceptが複数Topicに属してよい（例:「ハイブリッド戦争」が
  // 「情報・インテリジェンス」と「安全保障」の両方に関連する、など）。
  topicIds: z.array(z.string()).default([]),
  status: conceptStatusSchema.default("active"),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ConceptDocument = z.infer<typeof conceptDocumentSchema>;

// Concept名の表記揺れ（前後の空白・大文字小文字）を吸収するための単純な正規化。
// knowledge.tsのnormalizeForDedupと同じ思想（Embedding等の高度な類似度判定はスコープ外）。
export function normalizeConceptName(name: string): string {
  return name.trim().toLowerCase();
}

function getCollection() {
  return getMongoClient().db(MONGODB_DB_NAME).collection<Omit<ConceptDocument, "_id">>(CONCEPT_COLLECTION);
}

export async function getUserConcepts(userId: string): Promise<ConceptDocument[]> {
  return getCollection().find({ userId }).toArray();
}

// 正規化名が一致する既存のactive Conceptがあれば再利用し、無ければ新規作成する。
// 「同じConceptを不必要に増やさない」ための唯一の入口として、Concept作成はこの関数を通す。
export async function findOrCreateConcept(userId: string, name: string): Promise<ConceptDocument> {
  const trimmed = name.trim();
  const collection = getCollection();
  // MongoDBのクエリだけではnormalizeConceptName相当の比較ができないため、
  // active Conceptを取得してJS側で正規化比較する（MVP規模のConcept数なら全件走査で十分）。
  const existing = await collection.find({ userId, status: "active" }).toArray();
  const normalized = normalizeConceptName(trimmed);
  const match = existing.find((c) => normalizeConceptName(c.name) === normalized);
  if (match) return match;

  const now = new Date();
  const doc: Omit<ConceptDocument, "_id"> = {
    userId,
    name: trimmed,
    topicIds: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  const result = await collection.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function getConceptById(userId: string, conceptId: string): Promise<ConceptDocument | null> {
  return getCollection().findOne({ _id: new ObjectId(conceptId), userId });
}

export async function addTopicToConcept(userId: string, conceptId: string, topicId: string): Promise<void> {
  await getCollection().updateOne(
    { _id: new ObjectId(conceptId), userId },
    { $addToSet: { topicIds: topicId }, $set: { updatedAt: new Date() } },
  );
}

// sourceConceptをtargetConceptへ統合する。sourceはstatus: "merged"にする（削除はしない）。
// Knowledge.conceptIdsの付け替えはunderstandingStructure.ts側の責務とする
// （Knowledgeコレクションを横断する必要があるため）。
export async function mergeConcepts(userId: string, sourceConceptId: string, targetConceptId: string): Promise<void> {
  if (sourceConceptId === targetConceptId) return;
  await getCollection().updateOne(
    { _id: new ObjectId(sourceConceptId), userId },
    { $set: { status: "merged", updatedAt: new Date() } },
  );
}

export async function archiveConcept(userId: string, conceptId: string): Promise<void> {
  await getCollection().updateOne(
    { _id: new ObjectId(conceptId), userId },
    { $set: { status: "archived", updatedAt: new Date() } },
  );
}
