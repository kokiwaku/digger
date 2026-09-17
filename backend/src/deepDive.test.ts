import { test } from "node:test";
import assert from "node:assert/strict";
import { createBuildDeepDiveResponse, parseDeepDiveInput } from "./deepDive.js";
import { deepDiveResponseSchema } from "./llm/deepDive.js";

const ARTICLE_ANALYSIS = {
  summary: "テスト用の要約です。",
  whyItMatters: "テスト用の重要性の説明です。",
  concepts: [{ id: "concept-1", name: "テスト概念", description: "説明", importance: "required" as const }],
  entities: [],
  connections: [],
  deepDiveQuestions: ["なぜ？"],
};

// buildDeepDiveResponse()（default export）はMongoDBに接続する既定のresolveUserKnowledgeを
// 使うため、ユニットテストでは常にcreateBuildDeepDiveResponse()にフェイクのresolverを注入する
// （articleAnalysis.vertex.test.ts等のgetProvider注入と同じ理由）。

test("parseDeepDiveInput accepts a valid request body", () => {
  const input = parseDeepDiveInput({
    articleAnalysis: ARTICLE_ANALYSIS,
    question: "なぜこれが起きたの？",
    conversationHistory: [],
  });
  assert.equal(input.question, "なぜこれが起きたの？");
});

test("parseDeepDiveInput rejects a missing question", () => {
  assert.throws(() =>
    parseDeepDiveInput({ articleAnalysis: ARTICLE_ANALYSIS, conversationHistory: [] }),
  );
});

test("buildDeepDiveResponse returns a schema-valid response via the mock provider (/api/deep-dive happy path)", async () => {
  const original = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  try {
    const buildDeepDiveResponse = createBuildDeepDiveResponse(async () => undefined);
    const input = parseDeepDiveInput({
      articleAnalysis: ARTICLE_ANALYSIS,
      question: "なぜこれが起きたの？",
      conversationHistory: [],
    });
    const result = await buildDeepDiveResponse(input);

    assert.doesNotThrow(() => deepDiveResponseSchema.parse(result));
    assert.match(result.answer, /なぜこれが起きたの？/);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});

test("buildDeepDiveResponse does not call resolveUserKnowledge when the client already provided userKnowledge", async () => {
  const original = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  try {
    let resolverCalled = false;
    const buildDeepDiveResponse = createBuildDeepDiveResponse(async () => {
      resolverCalled = true;
      return [];
    });
    const input = parseDeepDiveInput({
      articleAnalysis: ARTICLE_ANALYSIS,
      question: "なぜこれが起きたの？",
      conversationHistory: [],
      userKnowledge: [{ id: "k1", concept: "テスト概念", statement: "既知の内容" }],
    });
    await buildDeepDiveResponse(input);

    assert.equal(resolverCalled, false);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});

test("buildDeepDiveResponse calls resolveUserKnowledge when the client did not provide userKnowledge", async () => {
  const original = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  try {
    let resolverCalled = false;
    const buildDeepDiveResponse = createBuildDeepDiveResponse(async () => {
      resolverCalled = true;
      return undefined;
    });
    const input = parseDeepDiveInput({
      articleAnalysis: ARTICLE_ANALYSIS,
      question: "なぜこれが起きたの？",
      conversationHistory: [],
    });
    await buildDeepDiveResponse(input);

    assert.equal(resolverCalled, true);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});
