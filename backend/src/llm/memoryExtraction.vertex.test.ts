import { test } from "node:test";
import assert from "node:assert/strict";
import { createVertexMemoryExtractionService } from "./memoryExtraction.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import type { GenerateTextInput, LlmProvider } from "./provider/llmProvider.js";
import type { MemoryExtractionInput } from "./memoryExtraction.js";

const fakeProvider = (generateText: LlmProvider["generateText"]): LlmProvider => ({
  generateText,
});

const validInput: MemoryExtractionInput = {
  source: { type: "web_article", url: "https://example.com/article", title: "車選びに関する記事" },
  articleAnalysis: {
    summary: "記事の要約",
    whyItMatters: "重要な理由",
    concepts: [{ id: "c1", name: "SUV", description: "背が高く車高のある乗用車の一種", importance: "required" }],
    entities: [],
    connections: [],
    deepDiveQuestions: [],
  },
  conversation: [
    { role: "user", content: "子供2人が酔いづらくて、それなりに大きい車がいい。国産がいいな。" },
    { role: "assistant", content: "SUVが候補になりそうです。" },
    { role: "user", content: "RAV4良さそう。フォレスターも比較したい。" },
  ],
};

function knowledgeCandidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "knowledge",
    title: "SUV",
    content: "SUVは一般にミニバンより重心が低く、揺れを感じにくい傾向がある",
    reason: "ユーザーが自分の言葉で確認した",
    confidence: "high",
    ...overrides,
  };
}

test("MemoryExtractionService success on first call and generates ids", async () => {
  const provider = fakeProvider(async () => JSON.stringify({ candidates: [knowledgeCandidate()] }));

  const service = createVertexMemoryExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].type, "knowledge");
  assert.ok(typeof result.candidates[0].id === "string" && result.candidates[0].id.length > 0);
});

test("MemoryExtractionService accepts a mix of preference/candidate/decision/open_question types", async () => {
  const provider = fakeProvider(async () =>
    JSON.stringify({
      candidates: [
        { type: "preference", content: "子供2人が酔いづらいことを重視する", confidence: "high" },
        { type: "preference", content: "国産車を優先したい", confidence: "high" },
        {
          type: "candidate",
          title: "トヨタ RAV4",
          content: "トヨタ RAV4",
          metadata: { reasons: ["後席が広い", "国産"] },
          confidence: "medium",
        },
        {
          type: "candidate",
          title: "スバル フォレスター",
          content: "スバル フォレスター",
          confidence: "medium",
        },
        { type: "open_question", content: "RAV4とフォレスターを比較したい", confidence: "medium" },
      ],
    }),
  );

  const service = createVertexMemoryExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(result.candidates.length, 5);
  const types = result.candidates.map((c) => c.type).sort();
  assert.deepEqual(types, ["candidate", "candidate", "open_question", "preference", "preference"]);
  const rav4 = result.candidates.find((c) => c.title === "トヨタ RAV4");
  assert.deepEqual(rav4?.metadata, { reasons: ["後席が広い", "国産"] });
});

test("MemoryExtractionService rejects candidates with an invalid type, then succeeds on retry", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    if (callCount === 1) {
      return JSON.stringify({ candidates: [{ type: "not-a-real-type", content: "x", confidence: "high" }] });
    }
    return JSON.stringify({ candidates: [knowledgeCandidate()] });
  });

  const service = createVertexMemoryExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(callCount, 2);
  assert.equal(result.candidates.length, 1);
});

test("MemoryExtractionService passes the conversation and instructs the LLM not to fabricate preference/candidate/decision", async () => {
  let capturedPrompt = "";
  let capturedSystemPrompt = "";
  const provider = fakeProvider(async (input: GenerateTextInput) => {
    capturedPrompt = input.prompt;
    capturedSystemPrompt = input.systemPrompt;
    return JSON.stringify({ candidates: [] });
  });

  const service = createVertexMemoryExtractionService(() => provider);
  await service.extract(validInput);

  assert.ok(capturedPrompt.includes("RAV4良さそう"));
  assert.ok(capturedSystemPrompt.includes("勝手に推測してはいけません"));
  assert.ok(capturedSystemPrompt.includes("捏造"));
});

test("MemoryExtractionService supports relationToExisting on knowledge candidates only", async () => {
  const provider = fakeProvider(async () =>
    JSON.stringify({
      candidates: [
        knowledgeCandidate({
          relationToExisting: { type: "extends", knowledgeId: "existing-1", reason: "既存理解を前提にさらに広がった" },
        }),
      ],
    }),
  );

  const service = createVertexMemoryExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(result.candidates[0].relationToExisting?.type, "extends");
});

test("MemoryExtractionService throws LlmProviderError after retry also fails", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    return "always invalid";
  });

  const service = createVertexMemoryExtractionService(() => provider);

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

test("MemoryExtractionService handles markdown-fenced JSON output", async () => {
  const provider = fakeProvider(async () => "```json\n" + JSON.stringify({ candidates: [knowledgeCandidate()] }) + "\n```");

  const service = createVertexMemoryExtractionService(() => provider);
  const result = await service.extract(validInput);

  assert.equal(result.candidates.length, 1);
});

test("MemoryExtractionService supports an empty candidate list", async () => {
  const provider = fakeProvider(async () => JSON.stringify({ candidates: [] }));

  const service = createVertexMemoryExtractionService(() => provider);
  const result = await service.extract({ ...validInput, conversation: [] });

  assert.deepEqual(result.candidates, []);
});

test("MemoryExtractionService formats a concept_dig source correctly (does not mislabel it as image input)", async () => {
  let capturedPrompt = "";
  const provider = fakeProvider(async (input: GenerateTextInput) => {
    capturedPrompt = input.prompt;
    return JSON.stringify({ candidates: [] });
  });

  const service = createVertexMemoryExtractionService(() => provider);
  await service.extract({ ...validInput, source: { type: "concept_dig", conceptId: "concept-1", title: "RAV4" } });

  assert.ok(capturedPrompt.includes("RAV4"));
  assert.ok(capturedPrompt.includes("Concept"));
  assert.ok(!capturedPrompt.includes("画像入力"));
});
