import { test } from "node:test";
import assert from "node:assert/strict";
import { getLlmProvider } from "./llmProviderFactory.js";
import { MockLlmProvider } from "./mockLlmProvider.js";
import { LlmProviderError } from "./llmProviderError.js";

test("getLlmProvider('mock') returns a MockLlmProvider", () => {
  const provider = getLlmProvider("mock");
  assert.ok(provider instanceof MockLlmProvider);
});

test("getLlmProvider defaults to mock when LLM_PROVIDER is unset", () => {
  const original = process.env.LLM_PROVIDER;
  delete process.env.LLM_PROVIDER;
  try {
    const provider = getLlmProvider();
    assert.ok(provider instanceof MockLlmProvider);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});

test("getLlmProvider throws for an unknown provider name", () => {
  assert.throws(
    () => getLlmProvider("something-unknown"),
    (err: unknown) => err instanceof LlmProviderError && err.code === "config_missing",
  );
});

test("MockLlmProvider echoes the prompt without calling any external service", async () => {
  const provider = getLlmProvider("mock");
  const response = await provider.generateText({ prompt: "日本の中央銀行は何ですか？" });
  assert.match(response, /日本の中央銀行は何ですか？/);
});
