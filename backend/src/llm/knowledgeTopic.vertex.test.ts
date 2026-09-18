import { test } from "node:test";
import assert from "node:assert/strict";
import { createVertexKnowledgeTopicService } from "./knowledgeTopic.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import type { GenerateTextInput, LlmProvider } from "./provider/llmProvider.js";
import type { KnowledgeTopicInput } from "./knowledgeTopic.js";

const fakeProvider = (generateText: LlmProvider["generateText"]): LlmProvider => ({
  generateText,
});

const validInput: KnowledgeTopicInput = {
  items: [
    { id: "1", concept: "政策金利", statement: "政策金利の変更は市場金利に波及する" },
    { id: "2", concept: "為替レート", statement: "金利差は為替の変動要因になる" },
  ],
  existingTopicPaths: [],
};

test("classify() returns validated assignments on the first try", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    return JSON.stringify({
      assignments: [
        { id: "1", path: ["経済", "金融政策", "政策金利"] },
        { id: "2", path: ["経済", "為替"] },
      ],
    });
  });

  const service = createVertexKnowledgeTopicService(() => provider);
  const result = await service.classify(validInput);

  assert.equal(callCount, 1);
  assert.equal(result.assignments.length, 2);
  assert.deepEqual(result.assignments[0].path, ["経済", "金融政策", "政策金利"]);
});

test("classify() rejects a path deeper than 3 levels and retries", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    if (callCount === 1) {
      return JSON.stringify({
        assignments: [
          { id: "1", path: ["経済", "金融政策", "中央銀行", "政策金利"] },
          { id: "2", path: ["経済"] },
        ],
      });
    }
    return JSON.stringify({
      assignments: [
        { id: "1", path: ["経済", "政策金利"] },
        { id: "2", path: ["経済"] },
      ],
    });
  });

  const service = createVertexKnowledgeTopicService(() => provider);
  const result = await service.classify(validInput);

  assert.equal(callCount, 2);
  assert.equal(result.assignments.length, 2);
});

test("classify() throws after the retry also fails", async () => {
  const provider = fakeProvider(async () => "not json");

  const service = createVertexKnowledgeTopicService(() => provider);

  await assert.rejects(
    () => service.classify(validInput),
    (err: unknown) => {
      assert.ok(err instanceof LlmProviderError);
      assert.equal(err.code, "empty_response");
      return true;
    },
  );
});

test("classify() does not retry when the provider itself throws", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    throw new LlmProviderError("timeout", "timeout");
  });

  const service = createVertexKnowledgeTopicService(() => provider);

  await assert.rejects(() => service.classify(validInput));
  assert.equal(callCount, 1);
});

test("classify() includes existingTopicPaths in the prompt so names can be reused", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify({ assignments: [{ id: "1", path: ["経済"] }, { id: "2", path: ["経済"] }] });
  });

  const service = createVertexKnowledgeTopicService(() => provider);
  await service.classify({ ...validInput, existingTopicPaths: [["経済", "金融政策"]] });

  assert.ok(capturedInput);
  assert.match(capturedInput.prompt, /経済 > 金融政策/);
});

test("classify() works with a single item and no existing topics", async () => {
  const provider = fakeProvider(async () => JSON.stringify({ assignments: [{ id: "1", path: ["国際情勢"] }] }));

  const service = createVertexKnowledgeTopicService(() => provider);
  const result = await service.classify({
    items: [{ id: "1", concept: "MI6", statement: "..." }],
    existingTopicPaths: [],
  });

  assert.equal(result.assignments.length, 1);
});
