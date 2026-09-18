import { test } from "node:test";
import assert from "node:assert/strict";
import { mapKnowledgeRelationTypeToConceptRelationType } from "./understandingStructure.js";

test("mapKnowledgeRelationTypeToConceptRelationType maps extends to extends", () => {
  assert.equal(mapKnowledgeRelationTypeToConceptRelationType("extends"), "extends");
});

test("mapKnowledgeRelationTypeToConceptRelationType maps supersedes to supersedes (no lossy conversion)", () => {
  assert.equal(mapKnowledgeRelationTypeToConceptRelationType("supersedes"), "supersedes");
});
