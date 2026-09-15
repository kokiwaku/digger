import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyVertexError, VertexGeminiProvider } from "./vertexGeminiProvider.js";
import { LlmProviderError } from "./llmProviderError.js";

const ENV_KEYS = ["GCP_PROJECT_ID", "GCP_LOCATION", "GEMINI_MODEL"] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const original: Partial<Record<string, string | undefined>> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];

  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test("VertexGeminiProvider throws config_missing when GCP_PROJECT_ID is unset", () => {
  withEnv({ GCP_PROJECT_ID: undefined, GCP_LOCATION: "us-central1", GEMINI_MODEL: "gemini-2.0-flash" }, () => {
    assert.throws(
      () => new VertexGeminiProvider(),
      (err: unknown) => err instanceof LlmProviderError && err.code === "config_missing",
    );
  });
});

test("VertexGeminiProvider throws config_missing when GEMINI_MODEL is unset", () => {
  withEnv({ GCP_PROJECT_ID: "my-project", GCP_LOCATION: "us-central1", GEMINI_MODEL: undefined }, () => {
    assert.throws(
      () => new VertexGeminiProvider(),
      (err: unknown) => err instanceof LlmProviderError && err.code === "config_missing",
    );
  });
});

test("VertexGeminiProvider constructs successfully when all env vars are set (no network call made)", () => {
  withEnv({ GCP_PROJECT_ID: "my-project", GCP_LOCATION: "us-central1", GEMINI_MODEL: "gemini-2.0-flash" }, () => {
    assert.doesNotThrow(() => new VertexGeminiProvider());
  });
});

test("classifyVertexError maps AbortError to timeout", () => {
  const abortError = new Error("The operation was aborted");
  abortError.name = "AbortError";
  const result = classifyVertexError(abortError);
  assert.equal(result.code, "timeout");
});

test("classifyVertexError maps HTTP 401/403 to auth_failed", () => {
  assert.equal(classifyVertexError({ status: 401, message: "Unauthorized" }).code, "auth_failed");
  assert.equal(classifyVertexError({ status: 403, message: "Forbidden" }).code, "auth_failed");
});

test("classifyVertexError maps HTTP 404 to invalid_model", () => {
  const result = classifyVertexError({ status: 404, message: "Requested entity was not found." }, "bad-model");
  assert.equal(result.code, "invalid_model");
});

test("classifyVertexError maps ADC-related messages to auth_failed", () => {
  const err = new Error("Could not load the default credentials");
  assert.equal(classifyVertexError(err).code, "auth_failed");
});

test("classifyVertexError falls back to api_error for unrecognized failures", () => {
  const err = new Error("Something else went wrong");
  assert.equal(classifyVertexError(err).code, "api_error");
});

test("classifyVertexError passes an already-classified LlmProviderError through unchanged", () => {
  const original = new LlmProviderError("already classified", "empty_response");
  assert.equal(classifyVertexError(original), original);
});
