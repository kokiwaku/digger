import { test } from "node:test";
import assert from "node:assert/strict";
import { deepDiveResponseSchema } from "./deepDive.js";
import { mockDeepDiveService } from "./deepDive.mock.js";
import { mockArticleAnalysisService } from "./articleAnalysis.mock.js";

test("mockDeepDiveService returns a schema-valid DeepDiveResponse", async () => {
  const articleAnalysis = await mockArticleAnalysisService.analyze({
    title: "any title",
    url: "https://example.com/any-article",
    content: "any content",
  });

  const result = await mockDeepDiveService.ask({
    articleAnalysis,
    question: "なぜ利上げすると円高になりやすいの？",
    conversationHistory: [],
  });

  assert.doesNotThrow(() => deepDiveResponseSchema.parse(result));
  assert.ok(result.answer.includes("なぜ利上げすると円高になりやすいの？"));
});

test("mockDeepDiveService excludes the asked question from suggestedFollowUps", async () => {
  const articleAnalysis = await mockArticleAnalysisService.analyze({
    title: "any title",
    url: "https://example.com/any-article",
    content: "any content",
  });
  const askedQuestion = articleAnalysis.deepDiveQuestions[0]!;

  const result = await mockDeepDiveService.ask({
    articleAnalysis,
    question: askedQuestion,
    conversationHistory: [],
  });

  assert.ok(!result.suggestedFollowUps.includes(askedQuestion));
});
