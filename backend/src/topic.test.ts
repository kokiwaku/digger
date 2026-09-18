import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTopicDepth,
  wouldCreateCycle,
  wouldExceedMaxDepth,
  isPathWithinMaxDepth,
  buildTopicPathStrings,
  topicDocumentSchema,
  MAX_TOPIC_DEPTH,
  type TopicLike,
} from "./topic.js";

test("computeTopicDepth returns 1 for a root topic", () => {
  const topics: TopicLike[] = [{ id: "a", parentId: null }];
  assert.equal(computeTopicDepth(topics, "a"), 1);
});

test("computeTopicDepth walks up the parent chain", () => {
  const topics: TopicLike[] = [
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
    { id: "grandchild", parentId: "child" },
  ];
  assert.equal(computeTopicDepth(topics, "grandchild"), 3);
});

test("computeTopicDepth does not infinite-loop on a corrupt cycle", () => {
  const topics: TopicLike[] = [
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
  ];
  assert.doesNotThrow(() => computeTopicDepth(topics, "a"));
});

test("wouldCreateCycle detects making a topic its own parent", () => {
  const topics: TopicLike[] = [{ id: "a", parentId: null }];
  assert.equal(wouldCreateCycle(topics, "a", "a"), true);
});

test("wouldCreateCycle detects making a topic a child of its own descendant", () => {
  const topics: TopicLike[] = [
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
  ];
  assert.equal(wouldCreateCycle(topics, "root", "child"), true);
});

test("wouldCreateCycle allows an unrelated reparenting", () => {
  const topics: TopicLike[] = [
    { id: "a", parentId: null },
    { id: "b", parentId: null },
  ];
  assert.equal(wouldCreateCycle(topics, "a", "b"), false);
});

test("wouldExceedMaxDepth is true once the new parent is already at max depth", () => {
  const topics: TopicLike[] = [
    { id: "root", parentId: null },
    { id: "mid", parentId: "root" },
    { id: "leaf", parentId: "mid" },
  ];
  assert.equal(wouldExceedMaxDepth(topics, "leaf"), true);
});

test("wouldExceedMaxDepth is false for a shallow new parent", () => {
  const topics: TopicLike[] = [{ id: "root", parentId: null }];
  assert.equal(wouldExceedMaxDepth(topics, "root"), false);
});

test("isPathWithinMaxDepth accepts 1 to MAX_TOPIC_DEPTH levels", () => {
  assert.equal(isPathWithinMaxDepth(["経済"]), true);
  assert.equal(isPathWithinMaxDepth(["経済", "金融政策", "政策金利"]), true);
  assert.equal(MAX_TOPIC_DEPTH, 3);
});

test("isPathWithinMaxDepth rejects an empty path or one deeper than MAX_TOPIC_DEPTH", () => {
  assert.equal(isPathWithinMaxDepth([]), false);
  assert.equal(isPathWithinMaxDepth(["1", "2", "3", "4"]), false);
});

test("buildTopicPathStrings reconstructs root-to-leaf name chains", () => {
  const topics = [
    { id: "root", parentId: null, name: "経済", status: "active" as const },
    { id: "child", parentId: "root", name: "金融政策", status: "active" as const },
  ];
  const paths = buildTopicPathStrings(topics);
  assert.deepEqual(paths.sort(), [["経済"], ["経済", "金融政策"]].sort());
});

test("buildTopicPathStrings excludes merged/archived topics", () => {
  const topics = [
    { id: "root", parentId: null, name: "経済", status: "merged" as const },
    { id: "other", parentId: null, name: "宇宙", status: "archived" as const },
    { id: "active", parentId: null, name: "AI", status: "active" as const },
  ];
  const paths = buildTopicPathStrings(topics);
  assert.deepEqual(paths, [["AI"]]);
});

test("topicDocumentSchema accepts a root topic (no parentId) with default status", () => {
  const parsed = topicDocumentSchema.parse({
    userId: "local-user",
    name: "経済",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(parsed.status, "active");
  assert.equal(parsed.parentId, undefined);
});

test("topicDocumentSchema accepts merged/archived status and an explicit parentId", () => {
  const merged = topicDocumentSchema.parse({
    userId: "local-user",
    name: "情報活動",
    parentId: "parent-id",
    status: "merged",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(merged.status, "merged");
  assert.equal(merged.parentId, "parent-id");

  const archived = topicDocumentSchema.parse({
    userId: "local-user",
    name: "古いトピック",
    status: "archived",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(archived.status, "archived");
});
