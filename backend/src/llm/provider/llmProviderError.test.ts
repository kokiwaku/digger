import { test } from "node:test";
import assert from "node:assert/strict";
import { LlmProviderError, toSafeApiResponse, type LlmProviderErrorCode } from "./llmProviderError.js";

const CODES: LlmProviderErrorCode[] = [
  "config_missing",
  "auth_failed",
  "invalid_model",
  "timeout",
  "api_error",
  "empty_response",
];

test("toSafeApiResponse returns a defined status/message for every error code", () => {
  for (const code of CODES) {
    const err = new LlmProviderError("some internal detail with credentials=SECRET", code);
    const { status, message } = toSafeApiResponse(err);
    assert.ok([500, 502, 504].includes(status));
    assert.ok(message.length > 0);
    // ユーザー向けメッセージには内部の詳細（元のmessage）を含めない
    assert.ok(!message.includes("SECRET"));
  }
});

test("timeout maps to 504 and api_error/empty_response map to 502", () => {
  assert.equal(toSafeApiResponse(new LlmProviderError("x", "timeout")).status, 504);
  assert.equal(toSafeApiResponse(new LlmProviderError("x", "api_error")).status, 502);
  assert.equal(toSafeApiResponse(new LlmProviderError("x", "empty_response")).status, 502);
});

test("config_missing/auth_failed/invalid_model map to 500", () => {
  assert.equal(toSafeApiResponse(new LlmProviderError("x", "config_missing")).status, 500);
  assert.equal(toSafeApiResponse(new LlmProviderError("x", "auth_failed")).status, 500);
  assert.equal(toSafeApiResponse(new LlmProviderError("x", "invalid_model")).status, 500);
});
