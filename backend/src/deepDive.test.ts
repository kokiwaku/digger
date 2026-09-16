import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeepDiveResponse, parseDeepDiveInput } from "./deepDive.js";
import { deepDiveResponseSchema } from "./llm/deepDive.js";

const ARTICLE_ANALYSIS = {
  summary: "テスト用の要約です。",
  whyItMatters: "テスト用の重要性の説明です。",
  concepts: [{ id: "concept-1", name: "テスト概念", description: "説明", importance: "required" as const }],
  entities: [],
  connections: [],
  deepDiveQuestions: ["なぜ？"],
};

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
