import { test } from "node:test";
import assert from "node:assert/strict";
import { createVertexArticleAnalysisService } from "./articleAnalysis.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import type { LlmProvider } from "./provider/llmProvider.js";

const VALID_ANALYSIS = {
  summary: "テスト用の要約です。",
  whyItMatters: "テスト用の重要性の説明です。",
  concepts: [
    { id: "concept-1", name: "テスト概念", description: "説明", importance: "required" as const },
  ],
  entities: [{ name: "テスト組織", type: "organization" as const, description: "説明" }],
  connections: [{ topic: "関連トピック", relation: "関連の説明" }],
  deepDiveQuestions: ["なぜ？", "どういう仕組み？", "誰にどう影響する？"],
};

const INPUT = { title: "テスト記事", url: "https://example.com/article", content: "本文" };

function fakeProvider(generateText: LlmProvider["generateText"]): LlmProvider {
  return { generateText };
}

test("analyze() returns validated data when the LLM returns valid JSON on the first try", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    return JSON.stringify(VALID_ANALYSIS);
  });

  const service = createVertexArticleAnalysisService(() => provider);
  const result = await service.analyze(INPUT);

  assert.deepEqual(result, VALID_ANALYSIS);
  assert.equal(callCount, 1);
});

test("analyze() accepts JSON wrapped in a markdown code fence", async () => {
  const provider = fakeProvider(async () => "```json\n" + JSON.stringify(VALID_ANALYSIS) + "\n```");
  const service = createVertexArticleAnalysisService(() => provider);

  const result = await service.analyze(INPUT);
  assert.deepEqual(result, VALID_ANALYSIS);
});

test("analyze() retries once when the first response fails JSON parsing, then succeeds", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    if (callCount === 1) return "this is not JSON";
    return JSON.stringify(VALID_ANALYSIS);
  });

  const service = createVertexArticleAnalysisService(() => provider);
  const result = await service.analyze(INPUT);

  assert.deepEqual(result, VALID_ANALYSIS);
  assert.equal(callCount, 2);
});

test("analyze() retries once when the first response fails schema validation, then succeeds", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    if (callCount === 1) return JSON.stringify({ summary: "missing everything else" });
    return JSON.stringify(VALID_ANALYSIS);
  });

  const service = createVertexArticleAnalysisService(() => provider);
  const result = await service.analyze(INPUT);

  assert.deepEqual(result, VALID_ANALYSIS);
  assert.equal(callCount, 2);
});

test("analyze() throws after the retry also fails schema validation", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    return "still not JSON";
  });

  const service = createVertexArticleAnalysisService(() => provider);

  await assert.rejects(
    () => service.analyze(INPUT),
    (err: unknown) => err instanceof LlmProviderError,
  );
  assert.equal(callCount, 2);
});

test("analyze() propagates an LLM provider error immediately without retrying", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    throw new LlmProviderError("timed out", "timeout");
  });

  const service = createVertexArticleAnalysisService(() => provider);

  await assert.rejects(
    () => service.analyze(INPUT),
    (err: unknown) => err instanceof LlmProviderError && err.code === "timeout",
  );
  assert.equal(callCount, 1);
});

test("analyze() works for pasted text input (no title/url)", async () => {
  const provider = fakeProvider(async () => JSON.stringify(VALID_ANALYSIS));
  const service = createVertexArticleAnalysisService(() => provider);

  const result = await service.analyze({ content: "貼り付けたテキストです。" });
  assert.deepEqual(result, VALID_ANALYSIS);
});

test("analyze() passes the image through to the provider's images option for image input", async () => {
  let receivedInput: Parameters<LlmProvider["generateText"]>[0] | undefined;
  const provider = fakeProvider(async (input) => {
    receivedInput = input;
    return JSON.stringify(VALID_ANALYSIS);
  });
  const service = createVertexArticleAnalysisService(() => provider);

  const result = await service.analyze({ image: { data: "aGVsbG8=", mimeType: "image/png" } });

  assert.deepEqual(result, VALID_ANALYSIS);
  assert.deepEqual(receivedInput?.images, [{ data: "aGVsbG8=", mimeType: "image/png" }]);
});

test("analyze() includes an image caption as extra context in the prompt without breaking the schema", async () => {
  let receivedInput: Parameters<LlmProvider["generateText"]>[0] | undefined;
  const provider = fakeProvider(async (input) => {
    receivedInput = input;
    return JSON.stringify(VALID_ANALYSIS);
  });
  const service = createVertexArticleAnalysisService(() => provider);

  await service.analyze({
    image: { data: "aGVsbG8=", mimeType: "image/png" },
    content: "このグラフの意味は？",
  });

  assert.ok(receivedInput?.prompt.includes("このグラフの意味は？"));
});

test("analyze() rejects an invalid enum value (e.g. importance) even if otherwise well-formed", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    if (callCount === 1) {
      return JSON.stringify({
        ...VALID_ANALYSIS,
        concepts: [{ ...VALID_ANALYSIS.concepts[0], importance: "critical" }],
      });
    }
    return JSON.stringify(VALID_ANALYSIS);
  });

  const service = createVertexArticleAnalysisService(() => provider);
  const result = await service.analyze(INPUT);

  assert.deepEqual(result, VALID_ANALYSIS);
  assert.equal(callCount, 2);
});
