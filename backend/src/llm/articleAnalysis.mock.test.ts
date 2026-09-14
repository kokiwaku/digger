import { test } from "node:test";
import assert from "node:assert/strict";
import { articleAnalysisSchema } from "./articleAnalysis.js";
import { mockArticleAnalysisService } from "./articleAnalysis.mock.js";

test("mockArticleAnalysisService returns a schema-valid ArticleAnalysis", async () => {
  const result = await mockArticleAnalysisService.analyze({
    title: "any title",
    url: "https://example.com/any-article",
    content: "any content",
  });

  assert.doesNotThrow(() => articleAnalysisSchema.parse(result));
  assert.ok(result.concepts.length > 0);
  assert.ok(result.deepDiveQuestions.length > 0);
});
