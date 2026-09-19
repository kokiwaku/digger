import { ObjectId } from "mongodb";
import { z } from "zod";
import { getMongoClient } from "./db.js";
import { FIXED_USER_ID, type KnowledgeDocument } from "./knowledge.js";
import { knowledgeSourceSchema, type KnowledgeSource } from "./knowledgeSource.js";

const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "digger";
const MEMORY_ITEM_COLLECTION = "memory_items";

// Diggerは「AIがKnowledgeを記録するサービス」ではなく「ユーザーが理解・判断・検討を
// 育てていくサービス」。そのため保存対象をKnowledge（理解した事実・概念）だけに限定せず、
// より広い「残したいこと」全般（MemoryItem）として扱えるようにする。
// - knowledge: ユーザーが理解した事実・概念（既存のKnowledgeがこれに相当する）
// - preference: ユーザー自身の条件・好み・重視点
// - candidate: ユーザーが検討している具体的な対象
// - decision: ユーザーが会話中に決めたこと
// - open_question: まだ結論が出ていない疑問・確認したいこと
export const memoryItemTypeSchema = z.enum(["knowledge", "preference", "candidate", "decision", "open_question"]);
export type MemoryItemType = z.infer<typeof memoryItemTypeSchema>;

// AIが一方的に保存内容を決めないという方針を、データ上でも表現するための出自フィールド。
// - ai_extracted: AI候補をユーザーが編集せずそのまま保存した
// - user_edited: AI候補をユーザーが編集してから保存した
// - user_created: ユーザーが「自分で追加」から作成した
export const memoryItemOriginSchema = z.enum(["ai_extracted", "user_created", "user_edited"]);
export type MemoryItemOrigin = z.infer<typeof memoryItemOriginSchema>;

// candidate（検討対象）専用の補足情報。今回はUIへの表示・編集までで、
// 比較画面やstatus管理UIは作り込まない（将来の比較機能のための受け皿として型だけ用意する）。
export const candidateMetadataSchema = z.object({
  reasons: z.array(z.string()).optional(),
  concerns: z.array(z.string()).optional(),
  status: z.enum(["candidate", "shortlisted", "selected", "rejected"]).optional(),
});
export type CandidateMetadata = z.infer<typeof candidateMetadataSchema>;

export const memoryItemStatusSchema = z.enum(["active", "archived"]);
export type MemoryItemStatus = z.infer<typeof memoryItemStatusSchema>;

// preference/candidate/decision/open_question用の永続化モデル。knowledgeは既存の
// user_knowledgeコレクション（knowledge.ts）に引き続き保存し、Map/Concept連携等の
// 既存機能を壊さない（Knowledgeだけが特別扱いされた構造を無理に統合しない）。
// GET /api/memoryでは、既存Knowledgeをtoggle: 'knowledge'のMemoryItemとして
// 見せるためのadapter（knowledgeDocumentToMemoryItem）と合わせて統一的に返す。
export const memoryItemDocumentSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  userId: z.string(),
  type: memoryItemTypeSchema,
  title: z.string().optional(),
  content: z.string(),
  metadata: candidateMetadataSchema.optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  source: knowledgeSourceSchema,
  origin: memoryItemOriginSchema,
  status: memoryItemStatusSchema.default("active"),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MemoryItemDocument = z.infer<typeof memoryItemDocumentSchema>;

// GET /api/memory・frontend向けの統一表現。knowledge/memory_items双方をこの形に揃える。
export interface MemoryItem {
  id: string;
  userId: string;
  type: MemoryItemType;
  title?: string;
  content: string;
  metadata?: CandidateMetadata;
  confidence?: "low" | "medium" | "high";
  source: KnowledgeSource;
  origin: MemoryItemOrigin;
  status: MemoryItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveMemoryItemInput {
  type: MemoryItemType;
  title?: string;
  content: string;
  metadata?: CandidateMetadata;
  confidence?: "low" | "medium" | "high";
  source: KnowledgeSource;
  origin: MemoryItemOrigin;
}

function getCollection() {
  return getMongoClient()
    .db(MONGODB_DB_NAME)
    .collection<Omit<MemoryItemDocument, "_id">>(MEMORY_ITEM_COLLECTION);
}

function normalizeForDedup(text: string): string {
  return text.trim().toLowerCase().replace(/[\s、。,.!！?？「」『』]/g, "");
}

// knowledgeと同じ「同一type + statement正規化後一致」の単純な重複判定。
// Embedding等の高度な類似度判定は引き続きスコープ外。
async function isDuplicateMemoryItem(userId: string, type: MemoryItemType, content: string): Promise<boolean> {
  const existing = await getCollection().find({ userId, type }).toArray();
  const normalized = normalizeForDedup(content);
  return existing.some((doc) => normalizeForDedup(doc.content) === normalized);
}

export function memoryItemDocumentToMemoryItem(doc: MemoryItemDocument): MemoryItem {
  return {
    id: doc._id?.toHexString() ?? "",
    userId: doc.userId,
    type: doc.type,
    title: doc.title,
    content: doc.content,
    metadata: doc.metadata,
    confidence: doc.confidence,
    source: doc.source,
    origin: doc.origin,
    status: doc.status ?? "active",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// 既存Knowledgeを、type: 'knowledge'のMemoryItemとして扱うためのadapter（#18）。
// 新しいmigrationスクリプトは作らず、読み取り時にその場で変換するだけに留める
// （既存のuser_knowledgeコレクション・GET /api/knowledgeの挙動は一切変更しない）。
export function knowledgeDocumentToMemoryItem(doc: KnowledgeDocument): MemoryItem {
  return {
    id: doc._id?.toHexString() ?? "",
    userId: doc.userId,
    type: "knowledge",
    title: doc.concept,
    content: doc.statement,
    confidence: doc.confidence,
    source: doc.source,
    // 既存Knowledgeにoriginの概念は無かったため、全てai_extracted由来として扱う
    // （Knowledge Extraction経由でしか保存されてこなかったため、実態と一致する）。
    origin: "ai_extracted",
    status: doc.status === "outdated" || doc.status === "merged" ? "archived" : "active",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function getUserMemoryItems(userId: string = FIXED_USER_ID): Promise<MemoryItemDocument[]> {
  return getCollection().find({ userId }).sort({ createdAt: -1 }).toArray();
}

// preference/candidate/decision/open_questionのみを保存する（knowledgeはknowledge.ts側の
// 既存フローに委ねる。呼び出し元のmemoryApi.tsがtypeで振り分ける）。
export async function saveMultipleMemoryItems(
  inputs: SaveMemoryItemInput[],
  userId: string = FIXED_USER_ID,
): Promise<{ saved: MemoryItemDocument[]; skipped: SaveMemoryItemInput[] }> {
  const collection = getCollection();
  const saved: MemoryItemDocument[] = [];
  const skipped: SaveMemoryItemInput[] = [];

  for (const input of inputs) {
    if (await isDuplicateMemoryItem(userId, input.type, input.content)) {
      skipped.push(input);
      continue;
    }

    const now = new Date();
    const doc: Omit<MemoryItemDocument, "_id"> = {
      userId,
      type: input.type,
      content: input.content,
      status: "active",
      source: input.source,
      origin: input.origin,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      createdAt: now,
      updatedAt: now,
    };

    const result = await collection.insertOne(doc);
    saved.push({ ...doc, _id: result.insertedId });
  }

  return { saved, skipped };
}
