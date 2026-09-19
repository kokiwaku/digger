import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryItemDocumentSchema, knowledgeDocumentToMemoryItem, memoryItemDocumentToMemoryItem } from "./memoryItem.js";
import { knowledgeDocumentSchema } from "./knowledge.js";

test("memoryItemDocumentSchema accepts a preference item without a title", () => {
  const result = memoryItemDocumentSchema.safeParse({
    userId: "local-user",
    type: "preference",
    content: "国産車を優先したい",
    source: { type: "text" },
    origin: "user_created",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.success, true);
});

test("memoryItemDocumentSchema accepts a candidate item with metadata", () => {
  const result = memoryItemDocumentSchema.safeParse({
    userId: "local-user",
    type: "candidate",
    title: "トヨタ RAV4",
    content: "トヨタ RAV4",
    metadata: { reasons: ["後席が広い"], concerns: ["やや大きい"], status: "candidate" },
    source: { type: "text" },
    origin: "ai_extracted",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.success, true);
});

test("memoryItemDocumentSchema rejects an invalid type", () => {
  const result = memoryItemDocumentSchema.safeParse({
    userId: "local-user",
    type: "not-a-real-type",
    content: "x",
    source: { type: "text" },
    origin: "user_created",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.success, false);
});

test("memoryItemDocumentSchema rejects an invalid candidate metadata.status", () => {
  const result = memoryItemDocumentSchema.safeParse({
    userId: "local-user",
    type: "candidate",
    content: "RAV4",
    metadata: { status: "not-a-real-status" },
    source: { type: "text" },
    origin: "ai_extracted",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.success, false);
});

test("knowledgeDocumentToMemoryItem converts an existing Knowledge document into a type: knowledge MemoryItem", () => {
  const knowledgeDoc = knowledgeDocumentSchema.parse({
    userId: "local-user",
    concept: "政策金利",
    statement: "政策金利の変更は市場金利に波及する",
    evidence: "根拠",
    confidence: "high",
    status: "active",
    source: { type: "web_article", url: "https://example.com", title: "記事" },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const memoryItem = knowledgeDocumentToMemoryItem(knowledgeDoc);

  assert.equal(memoryItem.type, "knowledge");
  assert.equal(memoryItem.title, "政策金利");
  assert.equal(memoryItem.content, "政策金利の変更は市場金利に波及する");
  assert.equal(memoryItem.origin, "ai_extracted");
  assert.equal(memoryItem.status, "active");
});

test("knowledgeDocumentToMemoryItem maps outdated/merged Knowledge status to archived", () => {
  const knowledgeDoc = knowledgeDocumentSchema.parse({
    userId: "local-user",
    concept: "政策金利",
    statement: "古い理解",
    evidence: "根拠",
    confidence: "high",
    status: "outdated",
    source: { type: "web_article", url: "https://example.com", title: "記事" },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.equal(knowledgeDocumentToMemoryItem(knowledgeDoc).status, "archived");
});

test("memoryItemDocumentToMemoryItem preserves origin and metadata as-is", () => {
  const memoryItem = memoryItemDocumentToMemoryItem({
    userId: "local-user",
    type: "candidate",
    title: "トヨタ RAV4",
    content: "トヨタ RAV4",
    metadata: { reasons: ["後席が広い"] },
    source: { type: "text" },
    origin: "user_edited",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.equal(memoryItem.origin, "user_edited");
  assert.deepEqual(memoryItem.metadata, { reasons: ["後席が広い"] });
});
