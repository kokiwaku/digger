import { test } from "node:test";
import assert from "node:assert/strict";
import { callLlmTest, parseLlmTestInput } from "./llmTest.js";

test("parseLlmTestInput accepts a valid message", () => {
  assert.equal(parseLlmTestInput({ message: "日本の中央銀行は何ですか？" }), "日本の中央銀行は何ですか？");
});

test("parseLlmTestInput rejects a missing message", () => {
  assert.throws(() => parseLlmTestInput({}));
});

test("parseLlmTestInput rejects an empty message", () => {
  assert.throws(() => parseLlmTestInput({ message: "" }));
});

test("callLlmTest returns the mock provider's response when LLM_PROVIDER=mock", async () => {
  const original = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  try {
    const response = await callLlmTest("日本の中央銀行は何ですか？");
    assert.match(response, /日本の中央銀行は何ですか？/);
  } finally {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  }
});
