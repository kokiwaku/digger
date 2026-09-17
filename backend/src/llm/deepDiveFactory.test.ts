import { test } from "node:test";
import assert from "node:assert/strict";
import { getDeepDiveService } from "./deepDiveFactory.js";
import { mockDeepDiveService } from "./deepDive.mock.js";
import { vertexDeepDiveService } from "./deepDive.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";

test("getDeepDiveService('mock') returns the mock service", () => {
  assert.equal(getDeepDiveService("mock"), mockDeepDiveService);
});

test("getDeepDiveService('vertex') returns the vertex service", () => {
  assert.equal(getDeepDiveService("vertex"), vertexDeepDiveService);
});

test("getDeepDiveService defaults to mock when LLM_PROVIDER is unset", () => {
  const original = process.env.LLM_PROVIDER;
  delete process.env.LLM_PROVIDER;
  try {
    assert.equal(getDeepDiveService(), mockDeepDiveService);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});

test("getDeepDiveService throws for an unknown provider name", () => {
  assert.throws(
    () => getDeepDiveService("something-unknown"),
    (err: unknown) => err instanceof LlmProviderError && err.code === "config_missing",
  );
});
