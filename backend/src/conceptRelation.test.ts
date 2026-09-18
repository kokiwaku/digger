import { test } from "node:test";
import assert from "node:assert/strict";
import { isSelfRelation, isDuplicateRelation, conceptRelationDocumentSchema } from "./conceptRelation.js";

test("isSelfRelation is true when from and to are the same concept", () => {
  assert.equal(isSelfRelation("concept-1", "concept-1"), true);
});

test("isSelfRelation is false for two different concepts", () => {
  assert.equal(isSelfRelation("concept-1", "concept-2"), false);
});

test("isDuplicateRelation detects an existing relation with the same from/to/type", () => {
  const existing = [{ fromConceptId: "a", toConceptId: "b", type: "extends" }];
  assert.equal(isDuplicateRelation(existing, { fromConceptId: "a", toConceptId: "b", type: "extends" }), true);
});

test("isDuplicateRelation treats a different type as not a duplicate", () => {
  const existing = [{ fromConceptId: "a", toConceptId: "b", type: "extends" }];
  assert.equal(isDuplicateRelation(existing, { fromConceptId: "a", toConceptId: "b", type: "related" }), false);
});

test("isDuplicateRelation treats reversed direction as not a duplicate", () => {
  const existing = [{ fromConceptId: "a", toConceptId: "b", type: "extends" }];
  assert.equal(isDuplicateRelation(existing, { fromConceptId: "b", toConceptId: "a", type: "extends" }), false);
});

test("conceptRelationDocumentSchema accepts every allowed relation type", () => {
  const types = ["related", "prerequisite", "part_of", "causes", "contrasts", "extends", "supersedes"] as const;
  for (const type of types) {
    const parsed = conceptRelationDocumentSchema.parse({
      userId: "local-user",
      fromConceptId: "a",
      toConceptId: "b",
      type,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.equal(parsed.type, type);
  }
});

test("conceptRelationDocumentSchema rejects an unknown relation type", () => {
  assert.throws(() =>
    conceptRelationDocumentSchema.parse({
      userId: "local-user",
      fromConceptId: "a",
      toConceptId: "b",
      type: "unknown_type",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
});
