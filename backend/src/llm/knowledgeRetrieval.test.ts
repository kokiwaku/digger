import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordKnowledgeRetrievalService, createHybridKnowledgeRetrievalService } from "./knowledgeRetrieval.js";
import type { ArticleAnalysis } from "./articleAnalysis.js";
import type { UserKnowledge } from "./personalizedAnalysis.js";
import type { LlmProvider } from "./provider/llmProvider.js";

const ARTICLE_ANALYSIS: ArticleAnalysis = {
  summary: "この記事は日本銀行の政策金利変更について解説しています。",
  whyItMatters: "金利は経済全体に影響します。",
  concepts: [
    { id: "c1", name: "政策金利", description: "中央銀行が決定する短期金利", importance: "required" },
    { id: "c2", name: "為替レート", description: "通貨同士の交換比率", importance: "helpful" },
  ],
  entities: [],
  connections: [],
  deepDiveQuestions: [],
};

function knowledge(overrides: Partial<UserKnowledge> = {}): UserKnowledge {
  return {
    id: "k-default",
    concept: "政策金利",
    statement: "政策金利の変更は市場金利や貸出金利に波及する",
    confidence: "high",
    ...overrides,
  };
}

test("retrieve selects knowledge relevant to the question", async () => {
  const relevant = knowledge({ id: "k1", concept: "政策金利" });
  const result = await keywordKnowledgeRetrievalService.retrieve({
    question: "今回の政策金利の変更で円高になりやすいのはなぜ？",
    articleAnalysis: ARTICLE_ANALYSIS,
    knowledge: [relevant],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "k1");
});

test("retrieve does not select knowledge unrelated to the question or article", async () => {
  const unrelated = knowledge({
    id: "k-unrelated",
    concept: "光合成",
    statement: "植物は光合成によってエネルギーを生成する",
  });
  const result = await keywordKnowledgeRetrievalService.retrieve({
    question: "今回の政策金利の変更で円高になりやすいのはなぜ？",
    articleAnalysis: ARTICLE_ANALYSIS,
    knowledge: [unrelated],
  });

  assert.deepEqual(result, []);
});

test("retrieve caps the number of returned items", async () => {
  const many: UserKnowledge[] = Array.from({ length: 10 }, (_, i) =>
    knowledge({ id: `k${i}`, concept: "政策金利", statement: `政策金利についての理解その${i}` }),
  );
  const result = await keywordKnowledgeRetrievalService.retrieve({
    question: "政策金利について教えて",
    articleAnalysis: ARTICLE_ANALYSIS,
    knowledge: many,
  });

  assert.ok(result.length <= 5, `expected at most 5 items, got ${result.length}`);
});

test("retrieve returns an empty array when there is no knowledge at all", async () => {
  const result = await keywordKnowledgeRetrievalService.retrieve({
    question: "政策金利について教えて",
    articleAnalysis: ARTICLE_ANALYSIS,
    knowledge: [],
  });

  assert.deepEqual(result, []);
});

test("retrieve ranks knowledge matching the article's concepts higher than an unrelated one", async () => {
  const matchesArticle = knowledge({ id: "k-article", concept: "為替レート", statement: "為替レートは複数の要因で変動する" });
  const unrelated = knowledge({ id: "k-other", concept: "光合成", statement: "植物は光合成をする" });

  const result = await keywordKnowledgeRetrievalService.retrieve({
    question: "円高になりやすい理由は？",
    articleAnalysis: ARTICLE_ANALYSIS,
    knowledge: [unrelated, matchesArticle],
  });

  assert.ok(result.some((k) => k.id === "k-article"));
  assert.ok(!result.some((k) => k.id === "k-other"));
});

function fakeProvider(generateText: LlmProvider["generateText"]): LlmProvider {
  return { generateText };
}

test("hybrid service uses the keyword result and does not call the LLM when keyword matching finds something", async () => {
  let providerCalled = false;
  const provider = fakeProvider(async () => {
    providerCalled = true;
    return JSON.stringify({ relevantIds: [] });
  });

  const service = createHybridKnowledgeRetrievalService(() => provider);
  const match = knowledge({ id: "k1", concept: "政策金利" });
  const result = await service.retrieve({
    question: "政策金利について教えて",
    articleAnalysis: ARTICLE_ANALYSIS,
    knowledge: [match],
  });

  assert.equal(providerCalled, false);
  assert.equal(result.length, 1);
});

test("hybrid service falls back to the LLM when keyword matching finds nothing, bridging a paraphrase", async () => {
  const provider = fakeProvider(async () => JSON.stringify({ relevantIds: ["k-policy-rate"] }));

  const service = createHybridKnowledgeRetrievalService(() => provider);
  const policyRateKnowledge = knowledge({
    id: "k-policy-rate",
    concept: "政策金利",
    statement: "政策金利の変更は市場金利や銀行の貸出金利にも影響が波及しうる",
  });

  // 「利上げ」という言い換えは政策金利という文字列を含まないため、キーワード一致では拾えない。
  const result = await service.retrieve({
    question: "今回の利上げで円高になりやすいのはなぜ？",
    articleAnalysis: { ...ARTICLE_ANALYSIS, concepts: [] },
    knowledge: [policyRateKnowledge],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "k-policy-rate");
});

test("hybrid service does not call the LLM when there is no knowledge at all", async () => {
  let providerCalled = false;
  const provider = fakeProvider(async () => {
    providerCalled = true;
    return JSON.stringify({ relevantIds: [] });
  });

  const service = createHybridKnowledgeRetrievalService(() => provider);
  const result = await service.retrieve({
    question: "何か質問",
    articleAnalysis: ARTICLE_ANALYSIS,
    knowledge: [],
  });

  assert.equal(providerCalled, false);
  assert.deepEqual(result, []);
});

test("hybrid service degrades gracefully to an empty array when the LLM fallback returns invalid JSON", async () => {
  const provider = fakeProvider(async () => "not valid json");

  const service = createHybridKnowledgeRetrievalService(() => provider);
  const result = await service.retrieve({
    question: "今回の利上げで円高になりやすいのはなぜ？",
    articleAnalysis: { ...ARTICLE_ANALYSIS, concepts: [] },
    knowledge: [knowledge({ id: "k1", concept: "政策金利" })],
  });

  assert.deepEqual(result, []);
});
