import { test } from "node:test";
import assert from "node:assert/strict";
import { knowledgeSourceSchema } from "./knowledgeSource.js";

test("knowledgeSourceSchema accepts a web_article source (existing shape)", () => {
  const result = knowledgeSourceSchema.safeParse({
    type: "web_article",
    url: "https://example.com/a",
    title: "記事タイトル",
  });
  assert.equal(result.success, true);
});

test("knowledgeSourceSchema accepts a text source with and without a title", () => {
  assert.equal(knowledgeSourceSchema.safeParse({ type: "text" }).success, true);
  assert.equal(knowledgeSourceSchema.safeParse({ type: "text", title: "メモ" }).success, true);
});

test("knowledgeSourceSchema accepts an image source with and without a title", () => {
  assert.equal(knowledgeSourceSchema.safeParse({ type: "image" }).success, true);
  assert.equal(knowledgeSourceSchema.safeParse({ type: "image", title: "スクリーンショット" }).success, true);
});

test("knowledgeSourceSchema accepts a concept_dig source with and without a title", () => {
  assert.equal(knowledgeSourceSchema.safeParse({ type: "concept_dig", conceptId: "c1" }).success, true);
  assert.equal(knowledgeSourceSchema.safeParse({ type: "concept_dig", conceptId: "c1", title: "MI6" }).success, true);
});

test("knowledgeSourceSchema rejects a concept_dig source missing conceptId", () => {
  assert.equal(knowledgeSourceSchema.safeParse({ type: "concept_dig" }).success, false);
});

test("knowledgeSourceSchema accepts a topic_dig source with and without a title", () => {
  assert.equal(knowledgeSourceSchema.safeParse({ type: "topic_dig", topicId: "t1" }).success, true);
  assert.equal(
    knowledgeSourceSchema.safeParse({ type: "topic_dig", topicId: "t1", title: "情報・インテリジェンス" }).success,
    true,
  );
});

test("knowledgeSourceSchema rejects a topic_dig source missing topicId", () => {
  assert.equal(knowledgeSourceSchema.safeParse({ type: "topic_dig" }).success, false);
});

test("knowledgeSourceSchema rejects a web_article source missing url/title", () => {
  assert.equal(knowledgeSourceSchema.safeParse({ type: "web_article" }).success, false);
  assert.equal(knowledgeSourceSchema.safeParse({ type: "web_article", url: "https://example.com" }).success, false);
});

test("knowledgeSourceSchema rejects an unknown type", () => {
  assert.equal(knowledgeSourceSchema.safeParse({ type: "pdf" }).success, false);
  assert.equal(knowledgeSourceSchema.safeParse({}).success, false);
});
