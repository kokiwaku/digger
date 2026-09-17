import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeForDedup,
  getEffectiveStatus,
  isEligibleForDeepDive,
  shouldSkipAsReinforcement,
  buildRelatedKnowledgeIds,
  knowledgeDocumentSchema,
} from "./knowledge.js";

test("normalizeForDedup ignores whitespace and common punctuation", () => {
  const a = normalizeForDedup("政策金利は、市場金利に影響する。");
  const b = normalizeForDedup("政策金利は市場金利に影響する");
  assert.equal(a, b);
});

test("normalizeForDedup is case-insensitive", () => {
  assert.equal(normalizeForDedup("Web Scraping"), normalizeForDedup("web scraping"));
});

test("normalizeForDedup treats meaningfully different statements as different", () => {
  const a = normalizeForDedup("政策金利は市場金利に影響する");
  const b = normalizeForDedup("為替レートは輸出企業の業績に影響する");
  assert.notEqual(a, b);
});

test("getEffectiveStatus defaults to active when status is missing (backward compatibility)", () => {
  assert.equal(getEffectiveStatus({ status: undefined }), "active");
});

test("getEffectiveStatus returns the explicit status when present", () => {
  assert.equal(getEffectiveStatus({ status: "foundational" }), "foundational");
  assert.equal(getEffectiveStatus({ status: "merged" }), "merged");
  assert.equal(getEffectiveStatus({ status: "outdated" }), "outdated");
});

test("isEligibleForDeepDive allows active and foundational knowledge", () => {
  assert.equal(isEligibleForDeepDive({ status: "active" }), true);
  assert.equal(isEligibleForDeepDive({ status: "foundational" }), true);
});

test("isEligibleForDeepDive excludes merged and outdated knowledge", () => {
  assert.equal(isEligibleForDeepDive({ status: "merged" }), false);
  assert.equal(isEligibleForDeepDive({ status: "outdated" }), false);
});

test("isEligibleForDeepDive treats knowledge without a status as active (eligible)", () => {
  assert.equal(isEligibleForDeepDive({ status: undefined }), true);
});

test("shouldSkipAsReinforcement is true only for relationToExisting.type === 'reinforces'", () => {
  assert.equal(shouldSkipAsReinforcement({ type: "reinforces" }), true);
  assert.equal(shouldSkipAsReinforcement({ type: "extends" }), false);
  assert.equal(shouldSkipAsReinforcement({ type: "supersedes" }), false);
  assert.equal(shouldSkipAsReinforcement({ type: "new" }), false);
  assert.equal(shouldSkipAsReinforcement(undefined), false);
});

test("buildRelatedKnowledgeIds returns the referenced id wrapped in an array", () => {
  assert.deepEqual(buildRelatedKnowledgeIds({ type: "extends", knowledgeId: "abc123" }), ["abc123"]);
});

test("buildRelatedKnowledgeIds returns undefined when there is no knowledgeId", () => {
  assert.equal(buildRelatedKnowledgeIds({ type: "new" }), undefined);
  assert.equal(buildRelatedKnowledgeIds(undefined), undefined);
});

test("knowledgeDocumentSchema accepts a legacy document without status or relatedKnowledgeIds", () => {
  const legacyDoc = {
    userId: "local-user",
    concept: "政策金利",
    statement: "政策金利の変更は市場金利に波及する",
    evidence: "根拠",
    confidence: "high" as const,
    source: { type: "web_article" as const, url: "https://example.com", title: "記事" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const parsed = knowledgeDocumentSchema.parse(legacyDoc);
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.relatedKnowledgeIds, undefined);
  assert.equal(getEffectiveStatus(parsed), "active");
});

test("knowledgeDocumentSchema accepts a document with status and relatedKnowledgeIds", () => {
  const doc = {
    userId: "local-user",
    concept: "政策金利",
    statement: "政策金利の変更は市場金利に波及する、という理解をさらに深めた内容",
    evidence: "根拠",
    confidence: "high" as const,
    status: "active" as const,
    source: { type: "web_article" as const, url: "https://example.com", title: "記事" },
    relatedKnowledgeIds: ["existing-id-1"],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const parsed = knowledgeDocumentSchema.parse(doc);
  assert.equal(parsed.status, "active");
  assert.deepEqual(parsed.relatedKnowledgeIds, ["existing-id-1"]);
});
