import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExtractKnowledgeRequest,
  parseSaveKnowledgeRequest,
  filterForConfirmationUi,
} from "./knowledgeApi.js";

const validArticleAnalysis = {
  summary: "記事の要約",
  whyItMatters: "重要な理由",
  concepts: [],
  entities: [],
  connections: [],
  deepDiveQuestions: [],
};

const validSource = { type: "web_article", url: "https://example.com", title: "テスト記事" };

test("parseExtractKnowledgeRequest accepts a valid request", () => {
  const request = parseExtractKnowledgeRequest({
    source: validSource,
    articleAnalysis: validArticleAnalysis,
    conversationHistory: [{ role: "user", content: "質問" }],
  });
  assert.equal(request.source.title, "テスト記事");
  assert.equal(request.conversationHistory.length, 1);
});

test("parseExtractKnowledgeRequest works with an empty conversationHistory", () => {
  const request = parseExtractKnowledgeRequest({
    source: validSource,
    articleAnalysis: validArticleAnalysis,
    conversationHistory: [],
  });
  assert.deepEqual(request.conversationHistory, []);
});

test("parseExtractKnowledgeRequest rejects a missing source", () => {
  assert.throws(() =>
    parseExtractKnowledgeRequest({
      articleAnalysis: validArticleAnalysis,
      conversationHistory: [],
    }),
  );
});

test("parseExtractKnowledgeRequest rejects an invalid articleAnalysis", () => {
  assert.throws(() =>
    parseExtractKnowledgeRequest({
      source: validSource,
      articleAnalysis: { summary: "not enough fields" },
      conversationHistory: [],
    }),
  );
});

test("parseSaveKnowledgeRequest accepts a valid request", () => {
  const request = parseSaveKnowledgeRequest({
    source: validSource,
    candidates: [
      {
        id: "id-1",
        concept: "概念",
        statement: "理解した内容",
        evidence: "根拠",
        confidence: "high",
        isNew: true,
      },
    ],
  });
  assert.equal(request.candidates.length, 1);
});

test("parseSaveKnowledgeRequest rejects an empty candidates array", () => {
  assert.throws(() =>
    parseSaveKnowledgeRequest({
      source: validSource,
      candidates: [],
    }),
  );
});

test("parseSaveKnowledgeRequest accepts a candidate with relationToExisting", () => {
  const request = parseSaveKnowledgeRequest({
    source: validSource,
    candidates: [
      {
        id: "id-1",
        concept: "概念",
        statement: "理解した内容",
        evidence: "根拠",
        confidence: "high",
        isNew: false,
        relationToExisting: { type: "extends", knowledgeId: "existing-1", reason: "さらに深掘りした" },
      },
    ],
  });
  assert.equal(request.candidates[0].relationToExisting?.type, "extends");
});

test("parseSaveKnowledgeRequest rejects an invalid relationToExisting.type", () => {
  assert.throws(() =>
    parseSaveKnowledgeRequest({
      source: validSource,
      candidates: [
        {
          id: "id-1",
          concept: "概念",
          statement: "理解した内容",
          evidence: "根拠",
          confidence: "high",
          isNew: false,
          relationToExisting: { type: "not-a-real-relation" },
        },
      ],
    }),
  );
});

test("filterForConfirmationUi drops low-confidence candidates", () => {
  const result = filterForConfirmationUi({
    candidates: [
      { id: "1", concept: "a", statement: "sa", evidence: "ea", confidence: "high", isNew: true },
      { id: "2", concept: "b", statement: "sb", evidence: "eb", confidence: "low", isNew: true },
      { id: "3", concept: "c", statement: "sc", evidence: "ec", confidence: "medium", isNew: false },
    ],
  });

  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((c) => c.confidence !== "low"));
});
