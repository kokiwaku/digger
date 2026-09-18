import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConceptName, conceptDocumentSchema } from "./concept.js";

test("normalizeConceptName trims whitespace and lowercases", () => {
  assert.equal(normalizeConceptName("  MI6  "), "mi6");
  assert.equal(normalizeConceptName("MI6"), normalizeConceptName("mi6"));
});

test("normalizeConceptName treats meaningfully different names as different", () => {
  assert.notEqual(normalizeConceptName("MI6"), normalizeConceptName("SIS"));
});

test("conceptDocumentSchema defaults topicIds to an empty array and status to active", () => {
  const parsed = conceptDocumentSchema.parse({
    userId: "local-user",
    name: "MI6",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(parsed.topicIds, []);
  assert.equal(parsed.status, "active");
});

test("conceptDocumentSchema accepts a concept linked to multiple topics", () => {
  const parsed = conceptDocumentSchema.parse({
    userId: "local-user",
    name: "ハイブリッド戦争",
    topicIds: ["topic-info", "topic-security"],
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(parsed.topicIds, ["topic-info", "topic-security"]);
});

test("conceptDocumentSchema accepts merged/archived status", () => {
  const merged = conceptDocumentSchema.parse({
    userId: "local-user",
    name: "情報機関",
    status: "merged",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(merged.status, "merged");
});

test("conceptDocumentSchema rejects an empty name", () => {
  assert.throws(() =>
    conceptDocumentSchema.parse({
      userId: "local-user",
      name: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
});
