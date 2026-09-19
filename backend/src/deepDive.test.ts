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

// buildDeepDiveResponse()（default export）はMongoDBに接続する既定のresolveUserKnowledge/
// resolveRelevantMemoryを使うため、ユニットテストでは常にcreateBuildDeepDiveResponse()に
// フェイクのresolverを両方注入する（articleAnalysis.vertex.test.ts等のgetProvider注入と同じ理由）。
const noKnowledge = async () => undefined;
const noMemory = async () => undefined;

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

test("parseDeepDiveInput accepts relevantMemory items", () => {
  const input = parseDeepDiveInput({
    articleAnalysis: ARTICLE_ANALYSIS,
    question: "SUVを5台候補にして",
    conversationHistory: [],
    relevantMemory: [
      { type: "preference", content: "国産車を優先したい" },
      { type: "candidate", title: "トヨタ RAV4", content: "トヨタ RAV4", metadata: { reasons: ["後席が広い"] } },
    ],
  });
  assert.equal(input.relevantMemory?.length, 2);
});

test("parseDeepDiveInput rejects an invalid relevantMemory type", () => {
  assert.throws(() =>
    parseDeepDiveInput({
      articleAnalysis: ARTICLE_ANALYSIS,
      question: "質問",
      conversationHistory: [],
      relevantMemory: [{ type: "knowledge", content: "これはrelevantMemoryでは無効" }],
    }),
  );
});

test("buildDeepDiveResponse returns a schema-valid response via the mock provider (/api/deep-dive happy path)", async () => {
  const original = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  try {
    const buildDeepDiveResponse = createBuildDeepDiveResponse(noKnowledge, noMemory);
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
    }, noMemory);
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
    }, noMemory);
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

test("buildDeepDiveResponse does not call resolveRelevantMemory when the client already provided relevantMemory", async () => {
  const original = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  try {
    let resolverCalled = false;
    const buildDeepDiveResponse = createBuildDeepDiveResponse(noKnowledge, async () => {
      resolverCalled = true;
      return [];
    });
    const input = parseDeepDiveInput({
      articleAnalysis: ARTICLE_ANALYSIS,
      question: "SUVを5台候補にして",
      conversationHistory: [],
      relevantMemory: [{ type: "preference", content: "国産車を優先したい" }],
    });
    await buildDeepDiveResponse(input);

    assert.equal(resolverCalled, false);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});

test("buildDeepDiveResponse calls resolveRelevantMemory when the client did not provide relevantMemory", async () => {
  const original = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  try {
    let resolverCalled = false;
    const buildDeepDiveResponse = createBuildDeepDiveResponse(noKnowledge, async () => {
      resolverCalled = true;
      return undefined;
    });
    const input = parseDeepDiveInput({
      articleAnalysis: ARTICLE_ANALYSIS,
      question: "SUVを5台候補にして",
      conversationHistory: [],
    });
    await buildDeepDiveResponse(input);

    assert.equal(resolverCalled, true);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});
