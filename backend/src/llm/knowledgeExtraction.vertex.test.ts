import { test } from "node:test";
import assert from "node:assert/strict";
import { createVertexKnowledgeExtractionService } from "./knowledgeExtraction.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import type { GenerateTextInput, LlmProvider } from "./provider/llmProvider.js";
import type { KnowledgeExtractionInput } from "./knowledgeExtraction.js";

const fakeProvider = (generateText: LlmProvider["generateText"]): LlmProvider => ({
  generateText,
});

const validInput: KnowledgeExtractionInput = {
  source: { type: "web_article", url: "https://example.com/article", title: "利上げに関する記事" },
  articleAnalysis: {
    summary: "記事の要約",
    whyItMatters: "重要な理由",
    concepts: [{ id: "c1", name: "政策金利", description: "中央銀行が決める金利", importance: "required" }],
    entities: [],
    connections: [],
    deepDiveQuestions: [],
  },
  conversation: [
    { role: "user", content: "利上げすると住宅ローンにどう影響しますか?" },
    { role: "assistant", content: "変動金利のローンは返済額が増える可能性があります" },
    { role: "user", content: "つまり、政策金利が上がると変動金利ローンの返済も増えるということですね" },
  ],
};

function validCandidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    concept: "政策金利",
    statement: "政策金利の変更は市場金利や貸出金利に波及する",
    evidence: "ユーザーが利上げと住宅ローンの関係を自分の言葉で言い換えた",
    confidence: "high",
    isNew: true,
    ...overrides,
  };
}

test("KnowledgeExtractionService success on first call and generates ids", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    return JSON.stringify({ candidates: [validCandidate()] });
  });

  const service = createVertexKnowledgeExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(callCount, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].concept, "政策金利");
  assert.equal(typeof result.candidates[0].id, "string");
  assert.ok(result.candidates[0].id.length > 0);
});

test("KnowledgeExtractionService passes conversationHistory content into the prompt", async () => {
  let capturedPrompt = "";
  const provider = fakeProvider(async (input: GenerateTextInput) => {
    capturedPrompt = input.prompt;
    return JSON.stringify({ candidates: [] });
  });

  const service = createVertexKnowledgeExtractionService(() => provider);
  await service.extract(validInput);

  assert.ok(capturedPrompt.includes("利上げすると住宅ローンにどう影響しますか"));
  assert.ok(capturedPrompt.includes("変動金利のローンは返済額が増える可能性があります"));
  assert.ok(capturedPrompt.includes(validInput.source.title));
  assert.ok(capturedPrompt.includes(validInput.source.url));
});

test("KnowledgeExtractionService works when existingKnowledge is empty/undefined", async () => {
  const provider = fakeProvider(async () => JSON.stringify({ candidates: [validCandidate()] }));

  const service = createVertexKnowledgeExtractionService(() => provider);
  const result = await service.extract({ ...validInput, existingKnowledge: undefined });

  assert.equal(result.candidates.length, 1);
});

test("KnowledgeExtractionService passes existingKnowledge into the prompt for dedup", async () => {
  let capturedPrompt = "";
  const provider = fakeProvider(async (input: GenerateTextInput) => {
    capturedPrompt = input.prompt;
    return JSON.stringify({ candidates: [] });
  });

  const service = createVertexKnowledgeExtractionService(() => provider);
  await service.extract({
    ...validInput,
    existingKnowledge: [{ id: "k1", concept: "政策金利", statement: "既に知っている内容" }],
  });

  assert.ok(capturedPrompt.includes("既に知っている内容"));
});

test("KnowledgeExtractionService retries once on JSON parse failure then succeeds", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    if (callCount === 1) return "invalid json {";
    return JSON.stringify({ candidates: [validCandidate({ confidence: "medium" })] });
  });

  const service = createVertexKnowledgeExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(callCount, 2);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].confidence, "medium");
});

test("KnowledgeExtractionService retries once on schema validation failure then succeeds", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    if (callCount === 1) {
      return JSON.stringify({ candidates: [{ concept: "missing fields" }] });
    }
    return JSON.stringify({ candidates: [validCandidate()] });
  });

  const service = createVertexKnowledgeExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(callCount, 2);
  assert.equal(result.candidates.length, 1);
});

test("KnowledgeExtractionService throws LlmProviderError after retry also fails", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    return "always invalid";
  });

  const service = createVertexKnowledgeExtractionService(() => provider);

  await assert.rejects(
    () => service.extract(validInput),
    (err: unknown) => {
      assert.ok(err instanceof LlmProviderError);
      assert.equal(err.code, "empty_response");
      return true;
    },
  );
  assert.equal(callCount, 2);
});

test("KnowledgeExtractionService does not retry when the provider itself throws", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    throw new LlmProviderError("timeout", "timeout");
  });

  const service = createVertexKnowledgeExtractionService(() => provider);

  await assert.rejects(
    () => service.extract(validInput),
    (err: unknown) => {
      assert.ok(err instanceof LlmProviderError);
      assert.equal(err.code, "timeout");
      return true;
    },
  );
  assert.equal(callCount, 1);
});

test("KnowledgeExtractionService handles markdown-fenced JSON output", async () => {
  const provider = fakeProvider(
    async () => "```json\n" + JSON.stringify({ candidates: [validCandidate()] }) + "\n```",
  );

  const service = createVertexKnowledgeExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(result.candidates.length, 1);
});

test("KnowledgeExtractionService supports an empty candidate list", async () => {
  const provider = fakeProvider(async () => JSON.stringify({ candidates: [] }));

  const service = createVertexKnowledgeExtractionService(() => provider);
  const result = await service.extract({ ...validInput, conversation: [] });

  assert.deepEqual(result.candidates, []);
});
