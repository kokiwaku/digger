import { test } from "node:test";
import assert from "node:assert/strict";
import { getArticleAnalysisService } from "./articleAnalysisFactory.js";
import { mockArticleAnalysisService } from "./articleAnalysis.mock.js";
import { vertexArticleAnalysisService } from "./articleAnalysis.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";

test("getArticleAnalysisService('mock') returns the mock service", () => {
  assert.equal(getArticleAnalysisService("mock"), mockArticleAnalysisService);
});

test("getArticleAnalysisService('vertex') returns the vertex service", () => {
  assert.equal(getArticleAnalysisService("vertex"), vertexArticleAnalysisService);
});

test("getArticleAnalysisService defaults to mock when LLM_PROVIDER is unset", () => {
  const original = process.env.LLM_PROVIDER;
  delete process.env.LLM_PROVIDER;
  try {
    assert.equal(getArticleAnalysisService(), mockArticleAnalysisService);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});

test("getArticleAnalysisService throws for an unknown provider name", () => {
  assert.throws(
    () => getArticleAnalysisService("something-unknown"),
    (err: unknown) => err instanceof LlmProviderError && err.code === "config_missing",
  );
});
