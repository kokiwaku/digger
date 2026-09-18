import { ObjectId } from "mongodb";
import { z } from "zod";
import { getMongoClient } from "./db.js";

const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "digger";
const TOPIC_COLLECTION = "user_topics";

// Topicはグローバル固定マスタではなく、userIdごとに持つ可変の俯瞰用分類。
// 同じConceptでも、ユーザーによって整理されるTopicが異なって構わない。
// - active: 現在使われているTopic
// - merged: 別のTopicへ統合され、以後は参照専用（mergeTopics参照）
// - archived: もう使わないTopic（削除はしない）
export const topicStatusSchema = z.enum(["active", "merged", "archived"]);
export type TopicStatus = z.infer<typeof topicStatusSchema>;

export const topicDocumentSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  userId: z.string(),
  name: z.string().min(1),
  // ルートTopicはnull。子Topicは親TopicのidをhexIdで持つ。
  parentId: z.string().nullable().optional(),
  status: topicStatusSchema.default("active"),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TopicDocument = z.infer<typeof topicDocumentSchema>;

// MVPでは階層は最大2〜3階層を想定する（Topic分類promptの指示とも整合させる）。
export const MAX_TOPIC_DEPTH = 3;

export interface TopicLike {
  id: string;
  parentId?: string | null;
}

// topicIdの深さ（root=1）を、与えられたTopic集合から計算する。
// 壊れた循環（本来あってはならない）に対しても無限ループしないようガードする。
export function computeTopicDepth(topics: TopicLike[], topicId: string): number {
  const byId = new Map(topics.map((t) => [t.id, t]));
  let depth = 1;
  let current = byId.get(topicId);
  const seen = new Set<string>();

  while (current?.parentId) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    depth++;
    current = parent;
  }

  return depth;
}

// topicIdをnewParentIdの子にすると循環（自分自身や自分の子孫を親にする）になるかどうか。
export function wouldCreateCycle(topics: TopicLike[], topicId: string, newParentId: string): boolean {
  if (topicId === newParentId) return true;

  const byId = new Map(topics.map((t) => [t.id, t]));
  let current = byId.get(newParentId);
  const seen = new Set<string>();

  while (current) {
    if (current.id === topicId) return true;
    if (seen.has(current.id)) return true; // 既存の循環データを検知した場合も安全側に倒す
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return false;
}

// newParentIdの下に子を追加すると、MAX_TOPIC_DEPTHを超えてしまうかどうか。
export function wouldExceedMaxDepth(topics: TopicLike[], newParentId: string): boolean {
  return computeTopicDepth(topics, newParentId) >= MAX_TOPIC_DEPTH;
}

// LLM分類結果のようなpath（例:["経済","金融政策","政策金利"]）が、階層上限内かどうか。
export function isPathWithinMaxDepth(path: string[]): boolean {
  return path.length > 0 && path.length <= MAX_TOPIC_DEPTH;
}

export interface NamedTopicLike extends TopicLike {
  name: string;
  status?: TopicStatus;
}

// Topic階層から、root→leafの名前チェーン（例:["経済","金融政策"]）をすべて再構築する。
// Topic分類prompt（既存Topic構造の参考情報）や、将来のTopic Viewでの表示に使う。
// merged/archivedのTopicは、新規分類の再利用候補として扱わないため除外する。
export function buildTopicPathStrings(topics: NamedTopicLike[]): string[][] {
  const activeById = new Map(topics.filter((t) => (t.status ?? "active") === "active").map((t) => [t.id, t]));

  const paths: string[][] = [];
  for (const topic of activeById.values()) {
    const chain: string[] = [topic.name];
    let current = topic;
    const seen = new Set<string>([topic.id]);
    while (current.parentId) {
      const parent = activeById.get(current.parentId);
      if (!parent || seen.has(parent.id)) break;
      chain.unshift(parent.name);
      seen.add(parent.id);
      current = parent;
    }
    paths.push(chain);
  }
  return paths;
}

function getCollection() {
  return getMongoClient().db(MONGODB_DB_NAME).collection<Omit<TopicDocument, "_id">>(TOPIC_COLLECTION);
}

function toTopicLike(doc: TopicDocument): TopicLike {
  return { id: doc._id!.toHexString(), parentId: doc.parentId ?? null };
}

export async function getUserTopics(userId: string): Promise<TopicDocument[]> {
  return getCollection().find({ userId }).toArray();
}

// pathの各階層について、同じuserId・同じparentId・同じnameの既存active Topicを再利用し、
// 無ければ作成する。返り値はroot→leafのチェーン。
export async function findOrCreateTopicPath(userId: string, path: string[]): Promise<TopicDocument[]> {
  if (!isPathWithinMaxDepth(path)) {
    throw new Error(`topic path exceeds max depth of ${MAX_TOPIC_DEPTH}: ${JSON.stringify(path)}`);
  }

  const collection = getCollection();
  const chain: TopicDocument[] = [];
  let parentId: string | null = null;

  for (const rawName of path) {
    const name = rawName.trim();
    if (!name) continue;

    let existing: TopicDocument | null = await collection.findOne({ userId, parentId, name, status: "active" });
    if (!existing) {
      const now = new Date();
      const doc: Omit<TopicDocument, "_id"> = { userId, name, parentId, status: "active", createdAt: now, updatedAt: now };
      const result = await collection.insertOne(doc);
      existing = { ...doc, _id: result.insertedId };
    }

    chain.push(existing);
    parentId = existing._id!.toHexString();
  }

  return chain;
}

// Topicの親を変更する。循環・深さ超過になる変更は拒否する。
export async function setTopicParent(userId: string, topicId: string, newParentId: string | null): Promise<void> {
  if (newParentId) {
    const topics = (await getUserTopics(userId)).map(toTopicLike);
    if (wouldCreateCycle(topics, topicId, newParentId)) {
      throw new Error("changing this topic's parent would create a cycle");
    }
    if (wouldExceedMaxDepth(topics, newParentId)) {
      throw new Error(`changing this topic's parent would exceed max topic depth of ${MAX_TOPIC_DEPTH}`);
    }
  }

  await getCollection().updateOne(
    { _id: new ObjectId(topicId), userId },
    { $set: { parentId: newParentId, updatedAt: new Date() } },
  );
}

// sourceTopicをtargetTopicへ統合する。sourceを親に持つ子Topicはtargetの子へ付け替え、
// sourceはstatus: "merged"にする（削除はしない）。Conceptのtopic付け替えは
// understandingStructure.ts側（Concept.topicIdsを見て回る必要があるため）が担当する。
export async function mergeTopics(userId: string, sourceTopicId: string, targetTopicId: string): Promise<void> {
  if (sourceTopicId === targetTopicId) return;

  const collection = getCollection();
  await collection.updateMany(
    { userId, parentId: sourceTopicId },
    { $set: { parentId: targetTopicId, updatedAt: new Date() } },
  );
  await collection.updateOne(
    { _id: new ObjectId(sourceTopicId), userId },
    { $set: { status: "merged", updatedAt: new Date() } },
  );
}

export async function archiveTopic(userId: string, topicId: string): Promise<void> {
  await getCollection().updateOne(
    { _id: new ObjectId(topicId), userId },
    { $set: { status: "archived", updatedAt: new Date() } },
  );
}
