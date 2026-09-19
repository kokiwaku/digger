import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExtractMemoryRequest,
  parseSaveMemoryRequest,
  toDisplayCategory,
  shouldShowForConfirmation,
  attachRelatedKnowledge,
  type ConfirmationCandidate,
} from "./memoryApi.js";

const validArticleAnalysis = {
  summary: "記事の要約",
  whyItMatters: "重要な理由",
  concepts: [],
  entities: [],
  connections: [],
  deepDiveQuestions: [],
};

const validSource = { type: "web_article", url: "https://example.com", title: "テスト記事" };

test("parseExtractMemoryRequest accepts a valid request", () => {
  const request = parseExtractMemoryRequest({
    source: validSource,
    articleAnalysis: validArticleAnalysis,
    conversationHistory: [{ role: "user", content: "質問" }],
  });
  assert.equal(request.source.title, "テスト記事");
});

test("parseExtractMemoryRequest rejects a missing source", () => {
  assert.throws(() =>
    parseExtractMemoryRequest({ articleAnalysis: validArticleAnalysis, conversationHistory: [] }),
  );
});

test("parseSaveMemoryRequest accepts a knowledge item", () => {
  const request = parseSaveMemoryRequest({
    source: validSource,
    items: [{ id: "1", type: "knowledge", title: "概念", content: "理解した内容", confidence: "high", origin: "ai_extracted" }],
  });
  assert.equal(request.items.length, 1);
  assert.equal(request.items[0].type, "knowledge");
});

test("parseSaveMemoryRequest accepts a preference item without a title", () => {
  const request = parseSaveMemoryRequest({
    source: validSource,
    items: [{ id: "1", type: "preference", content: "国産車を優先したい", origin: "user_created" }],
  });
  assert.equal(request.items[0].type, "preference");
  assert.equal(request.items[0].title, undefined);
});

test("parseSaveMemoryRequest accepts a candidate item with metadata", () => {
  const request = parseSaveMemoryRequest({
    source: validSource,
    items: [
      {
        id: "1",
        type: "candidate",
        title: "トヨタ RAV4",
        content: "トヨタ RAV4",
        metadata: { reasons: ["後席が広い"], concerns: ["やや大きい"] },
        origin: "ai_extracted",
      },
    ],
  });
  assert.deepEqual(request.items[0].metadata, { reasons: ["後席が広い"], concerns: ["やや大きい"] });
});

test("parseSaveMemoryRequest rejects an invalid type", () => {
  assert.throws(() =>
    parseSaveMemoryRequest({
      source: validSource,
      items: [{ id: "1", type: "not-a-real-type", content: "x", origin: "user_created" }],
    }),
  );
});

test("parseSaveMemoryRequest rejects an invalid origin", () => {
  assert.throws(() =>
    parseSaveMemoryRequest({
      source: validSource,
      items: [{ id: "1", type: "preference", content: "x", origin: "ai_invented" }],
    }),
  );
});

test("parseSaveMemoryRequest rejects an empty items array", () => {
  assert.throws(() => parseSaveMemoryRequest({ source: validSource, items: [] }));
});

test("toDisplayCategory is undefined for non-knowledge types", () => {
  const candidate = { id: "1", type: "preference" as const, content: "国産車を優先したい", confidence: "high" as const };
  assert.equal(toDisplayCategory(candidate), undefined);
});

test("toDisplayCategory maps knowledge with no relation to 'new'", () => {
  const candidate = { id: "1", type: "knowledge" as const, content: "sa", confidence: "high" as const };
  assert.equal(toDisplayCategory(candidate), "new");
});

test("toDisplayCategory maps knowledge extends/supersedes to deepened/updated", () => {
  const base = { id: "1", type: "knowledge" as const, content: "sa", confidence: "high" as const };
  assert.equal(
    toDisplayCategory({ ...base, relationToExisting: { type: "extends" as const, knowledgeId: "e1" } }),
    "deepened",
  );
  assert.equal(
    toDisplayCategory({ ...base, relationToExisting: { type: "supersedes" as const, knowledgeId: "e1" } }),
    "updated",
  );
});

test("shouldShowForConfirmation excludes reinforces and low confidence regardless of type", () => {
  const knowledge = { id: "1", type: "knowledge" as const, content: "sa", confidence: "high" as const };
  assert.equal(shouldShowForConfirmation(knowledge), true);
  assert.equal(
    shouldShowForConfirmation({ ...knowledge, relationToExisting: { type: "reinforces" as const } }),
    false,
  );

  const lowConfidenceCandidate = { id: "2", type: "candidate" as const, content: "RAV4", confidence: "low" as const };
  assert.equal(shouldShowForConfirmation(lowConfidenceCandidate), false);

  const preference = { id: "3", type: "preference" as const, content: "国産がいい", confidence: "high" as const };
  assert.equal(shouldShowForConfirmation(preference), true);
});

test("attachRelatedKnowledge attaches the referenced existing knowledge's content for knowledge candidates", () => {
  const candidates: ConfirmationCandidate[] = [
    {
      id: "1",
      type: "knowledge",
      content: "波及の速さは中央銀行の信頼性にも左右される",
      confidence: "high",
      relationToExisting: { type: "extends", knowledgeId: "existing-1" },
      displayCategory: "deepened",
    },
  ];
  const existingKnowledge = [
    { id: "existing-1", concept: "政策金利", statement: "政策金利の変更は市場金利に波及する", confidence: "high" as const },
  ];

  const result = attachRelatedKnowledge(candidates, existingKnowledge);

  assert.deepEqual(result[0].relatedKnowledge, {
    concept: "政策金利",
    statement: "政策金利の変更は市場金利に波及する",
  });
});

test("attachRelatedKnowledge leaves non-knowledge candidates unchanged", () => {
  const candidates: ConfirmationCandidate[] = [
    { id: "1", type: "preference", content: "国産車を優先したい", confidence: "high" },
  ];

  const result = attachRelatedKnowledge(candidates, []);

  assert.equal(result[0].relatedKnowledge, undefined);
});
