import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeForDedup } from "./knowledge.js";

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
