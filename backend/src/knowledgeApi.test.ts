import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExtractKnowledgeRequest,
  parseSaveKnowledgeRequest,
  filterForConfirmationUi,
  toDisplayCategory,
  shouldShowForConfirmation,
  attachRelatedKnowledge,
  type ConfirmationCandidate,
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

test("filterForConfirmationUi excludes reinforces candidates from the confirmation list", () => {
  const result = filterForConfirmationUi({
    candidates: [
      { id: "1", concept: "a", statement: "sa", evidence: "ea", confidence: "high", isNew: true },
      {
        id: "2",
        concept: "b",
        statement: "sb",
        evidence: "eb",
        confidence: "high",
        isNew: false,
        relationToExisting: { type: "reinforces", knowledgeId: "existing-1" },
      },
    ],
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "1");
});

test("filterForConfirmationUi still works when only reinforces candidates exist (returns an empty list)", () => {
  const result = filterForConfirmationUi({
    candidates: [
      {
        id: "1",
        concept: "a",
        statement: "sa",
        evidence: "ea",
        confidence: "high",
        isNew: false,
        relationToExisting: { type: "reinforces", knowledgeId: "existing-1" },
      },
    ],
  });

  assert.deepEqual(result.candidates, []);
});

test("filterForConfirmationUi works with zero candidates", () => {
  const result = filterForConfirmationUi({ candidates: [] });
  assert.deepEqual(result.candidates, []);
});

test("toDisplayCategory maps new/undefined relationToExisting to 'new'", () => {
  const candidate = { id: "1", concept: "a", statement: "sa", evidence: "ea", confidence: "high" as const, isNew: true };
  assert.equal(toDisplayCategory(candidate), "new");

  const explicitNew = { ...candidate, relationToExisting: { type: "new" as const } };
  assert.equal(toDisplayCategory(explicitNew), "new");
});

test("toDisplayCategory maps extends to 'deepened'", () => {
  const candidate = {
    id: "1",
    concept: "a",
    statement: "sa",
    evidence: "ea",
    confidence: "high" as const,
    isNew: false,
    relationToExisting: { type: "extends" as const, knowledgeId: "existing-1" },
  };
  assert.equal(toDisplayCategory(candidate), "deepened");
});

test("toDisplayCategory maps supersedes to 'updated'", () => {
  const candidate = {
    id: "1",
    concept: "a",
    statement: "sa",
    evidence: "ea",
    confidence: "high" as const,
    isNew: false,
    relationToExisting: { type: "supersedes" as const, knowledgeId: "existing-1" },
  };
  assert.equal(toDisplayCategory(candidate), "updated");
});

test("shouldShowForConfirmation is false only for reinforces", () => {
  const base = { id: "1", concept: "a", statement: "sa", evidence: "ea", confidence: "high" as const, isNew: true };
  assert.equal(shouldShowForConfirmation(base), true);
  assert.equal(
    shouldShowForConfirmation({ ...base, relationToExisting: { type: "reinforces" as const } }),
    false,
  );
  assert.equal(shouldShowForConfirmation({ ...base, relationToExisting: { type: "extends" as const } }), true);
  assert.equal(shouldShowForConfirmation({ ...base, relationToExisting: { type: "supersedes" as const } }), true);
});

test("attachRelatedKnowledge attaches the referenced existing knowledge's content", () => {
  const candidates: ConfirmationCandidate[] = [
    {
      id: "1",
      concept: "波及メカニズム",
      statement: "波及の速さは中央銀行の信頼性にも左右される",
      evidence: "根拠",
      confidence: "high",
      isNew: false,
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

test("attachRelatedKnowledge leaves the candidate unchanged when there is no matching existing knowledge", () => {
  const candidates: ConfirmationCandidate[] = [
    {
      id: "1",
      concept: "a",
      statement: "sa",
      evidence: "ea",
      confidence: "high",
      isNew: true,
      displayCategory: "new",
    },
  ];

  const result = attachRelatedKnowledge(candidates, []);

  assert.equal(result[0].relatedKnowledge, undefined);
});
