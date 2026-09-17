import { ObjectId } from "mongodb";
import { z } from "zod";
import { getMongoClient } from "./db.js";

const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "digger";
const KNOWLEDGE_COLLECTION = "user_knowledge";

// 認証未実装のMVPのため、固定userIdで1ユーザー分のみを扱う。
export const FIXED_USER_ID = "local-user";

export const knowledgeDocumentSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  userId: z.string(),
  concept: z.string(),
  statement: z.string(),
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  source: z.object({
    type: z.literal("web_article"),
    url: z.string(),
    title: z.string(),
  }),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;

export interface SaveKnowledgeInput {
  concept: string;
  statement: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
  source: {
    type: "web_article";
    url: string;
    title: string;
  };
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

// 選択されたcandidateのみをMVP固定userIdで保存する。既存Knowledgeと重複するものは
// 無条件に保存せず、スキップとして扱う（呼び出し側が保存件数/スキップ件数を利用できる）。
export async function saveMultipleKnowledge(
  inputs: SaveKnowledgeInput[],
  userId: string = FIXED_USER_ID,
): Promise<{ saved: KnowledgeDocument[]; skipped: SaveKnowledgeInput[] }> {
  const collection = getCollection();
  const saved: KnowledgeDocument[] = [];
  const skipped: SaveKnowledgeInput[] = [];

  for (const input of inputs) {
    if (await isDuplicateKnowledge(userId, input.concept, input.statement)) {
      skipped.push(input);
      continue;
    }

    const now = new Date();
    const doc: Omit<KnowledgeDocument, "_id"> = {
      userId,
      concept: input.concept,
      statement: input.statement,
      evidence: input.evidence,
      confidence: input.confidence,
      source: input.source,
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
