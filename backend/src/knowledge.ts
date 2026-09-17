import { ObjectId } from "mongodb";
import { z } from "zod";
import { getMongoClient } from "./db.js";
import type { UserKnowledge } from "./llm/personalizedAnalysis.js";
import type { KnowledgeRelation } from "./llm/knowledgeExtraction.js";

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

export const knowledgeDocumentSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  userId: z.string(),
  concept: z.string(),
  statement: z.string(),
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  // optional: 未設定の既存ドキュメントとの後方互換性のため。実際の扱いはgetEffectiveStatus()を通すこと。
  status: knowledgeStatusSchema.optional(),
  source: z.object({
    type: z.literal("web_article"),
    url: z.string(),
    title: z.string(),
  }),
  // Knowledge Extraction時にrelationToExistingが既存Knowledgeを指していた場合、その_idを記録する。
  // 今回はここに記録するだけで、自動統合（merged/outdatedへの変更等）は行わない。
  relatedKnowledgeIds: z.array(z.string()).optional(),
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
  source: {
    type: "web_article";
    url: string;
    title: string;
  };
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
    const doc: Omit<KnowledgeDocument, "_id"> = {
      userId,
      concept: input.concept,
      statement: input.statement,
      evidence: input.evidence,
      confidence: input.confidence,
      status: "active",
      source: input.source,
      ...(relatedKnowledgeIds ? { relatedKnowledgeIds } : {}),
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
