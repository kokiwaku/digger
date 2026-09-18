import { test } from "node:test";
import assert from "node:assert/strict";
import { mockKnowledgeTopicService } from "./knowledgeTopic.mock.js";

test("mockKnowledgeTopicService returns one assignment per item, keyed by concept", async () => {
  const result = await mockKnowledgeTopicService.classify({
    items: [
      { id: "1", concept: "政策金利", statement: "..." },
      { id: "2", concept: "為替レート", statement: "..." },
    ],
    existingTopicPaths: [],
  });

  assert.equal(result.assignments.length, 2);
  assert.deepEqual(
    result.assignments.find((a) => a.id === "1")?.path,
    ["政策金利"],
  );
  assert.deepEqual(
    result.assignments.find((a) => a.id === "2")?.path,
    ["為替レート"],
  );
});

test("mockKnowledgeTopicService works with a single item", async () => {
  const result = await mockKnowledgeTopicService.classify({
    items: [{ id: "1", concept: "MI6", statement: "..." }],
    existingTopicPaths: [["国際情勢"]],
  });

  assert.equal(result.assignments.length, 1);
});
