import { ObjectId } from "mongodb";
import { z } from "zod";
import { getMongoClient } from "./db.js";
import { getUserConcepts } from "./concept.js";

const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "digger";
const CONCEPT_RELATION_COLLECTION = "concept_relations";

// Map上のedgeを表現するConcept間の関係。typeを増やしすぎないよう、
// 現在の実装（Knowledgeのextends/supersedes）と表現力のバランスが取れる範囲に絞る。
export const conceptRelationTypeSchema = z.enum([
  "related",
  "prerequisite",
  "part_of",
  "causes",
  "contrasts",
  "extends",
]);
export type ConceptRelationType = z.infer<typeof conceptRelationTypeSchema>;

export const conceptRelationDocumentSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  userId: z.string(),
  fromConceptId: z.string(),
  toConceptId: z.string(),
  type: conceptRelationTypeSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ConceptRelationDocument = z.infer<typeof conceptRelationDocumentSchema>;

export function isSelfRelation(fromConceptId: string, toConceptId: string): boolean {
  return fromConceptId === toConceptId;
}

export interface RelationLike {
  fromConceptId: string;
  toConceptId: string;
  type: string;
}

export function isDuplicateRelation(existing: RelationLike[], candidate: RelationLike): boolean {
  return existing.some(
    (r) =>
      r.fromConceptId === candidate.fromConceptId &&
      r.toConceptId === candidate.toConceptId &&
      r.type === candidate.type,
  );
}

function getCollection() {
  return getMongoClient()
    .db(MONGODB_DB_NAME)
    .collection<Omit<ConceptRelationDocument, "_id">>(CONCEPT_RELATION_COLLECTION);
}

export async function getUserConceptRelations(userId: string): Promise<ConceptRelationDocument[]> {
  return getCollection().find({ userId }).toArray();
}

export interface CreateConceptRelationInput {
  fromConceptId: string;
  toConceptId: string;
  type: ConceptRelationType;
}

// self-relationと、存在しないConceptへのrelationを拒否する。重複（同じfrom/to/type）は
// 新規作成せず既存のものを返す。いずれも「作られない」ケースなので戻り値はnull許容にする。
export async function createConceptRelation(
  userId: string,
  input: CreateConceptRelationInput,
): Promise<ConceptRelationDocument | null> {
  if (isSelfRelation(input.fromConceptId, input.toConceptId)) return null;

  const concepts = await getUserConcepts(userId);
  const conceptIds = new Set(concepts.map((c) => c._id!.toHexString()));
  if (!conceptIds.has(input.fromConceptId) || !conceptIds.has(input.toConceptId)) return null;

  const collection = getCollection();
  const existing = await collection.find({ userId }).toArray();
  const duplicate = existing.find(
    (r) => r.fromConceptId === input.fromConceptId && r.toConceptId === input.toConceptId && r.type === input.type,
  );
  if (duplicate) return duplicate;

  const now = new Date();
  const doc: Omit<ConceptRelationDocument, "_id"> = {
    userId,
    fromConceptId: input.fromConceptId,
    toConceptId: input.toConceptId,
    type: input.type,
    createdAt: now,
    updatedAt: now,
  };
  const result = await collection.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}
