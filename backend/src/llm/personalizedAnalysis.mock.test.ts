import { test } from "node:test";
import assert from "node:assert/strict";
import { mockArticleAnalysisService } from "./articleAnalysis.mock.js";
import { mockPersonalizedAnalysisService } from "./personalizedAnalysis.mock.js";

test("mockPersonalizedAnalysisService treats a known concept as alreadyKnown, not needing explanation", async () => {
  const articleAnalysis = await mockArticleAnalysisService.analyze({
    title: "any title",
    url: "https://example.com/any-article",
    content: "any content",
  });
  const knownConcept = articleAnalysis.concepts[0]!;

  const result = await mockPersonalizedAnalysisService.analyze({
    articleAnalysis,
    userKnowledge: [{ id: "k1", concept: knownConcept.name, statement: "既に理解済み" }],
  });

  assert.ok(result.alreadyKnown.includes(knownConcept.name));
  assert.ok(!result.needsExplanation.some((n) => n.conceptId === knownConcept.id));
  assert.ok(result.relatedPastKnowledge.some((r) => r.knowledgeId === "k1"));
});

test("mockPersonalizedAnalysisService flags unknown concepts as needing explanation", async () => {
  const articleAnalysis = await mockArticleAnalysisService.analyze({
    title: "any title",
    url: "https://example.com/any-article",
    content: "any content",
  });

  const result = await mockPersonalizedAnalysisService.analyze({
    articleAnalysis,
    userKnowledge: [],
  });

  assert.equal(result.alreadyKnown.length, 0);
  assert.equal(result.needsExplanation.length, articleAnalysis.concepts.length);
});
