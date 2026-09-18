import { test } from "node:test";
import assert from "node:assert/strict";
import { DigInputError, MAX_IMAGE_BYTES, MAX_TEXT_INPUT_LENGTH, parseArticleUrl, resolveInputSource } from "./dig.js";

// --- URL判定 ---

test("resolveInputSource treats a plain http(s) URL as type=url", () => {
  const result = resolveInputSource({ input: "https://example.com/article" });
  assert.deepEqual(result, { type: "url", url: "https://example.com/article" });
});

test("resolveInputSource accepts the legacy { url } request shape", () => {
  const result = resolveInputSource({ url: "https://example.com/article" });
  assert.deepEqual(result, { type: "url", url: "https://example.com/article" });
});

test("resolveInputSource does not misclassify a sentence that merely contains a URL as type=url", () => {
  // 空白を含む＝自由なテキストとみなし、URLっぽい文字列を誤ってURL扱いしない。
  const result = resolveInputSource({ input: "この記事 https://example.com が気になる" });
  assert.equal(result.type, "text");
});

test("resolveInputSource treats free text as type=text", () => {
  const result = resolveInputSource({ input: "日銀が政策金利を引き上げた。" });
  assert.deepEqual(result, { type: "text", text: "日銀が政策金利を引き上げた。" });
});

test("resolveInputSource trims surrounding whitespace from text", () => {
  const result = resolveInputSource({ input: "  メモです  " });
  assert.deepEqual(result, { type: "text", text: "メモです" });
});

test("resolveInputSource rejects empty input", () => {
  assert.throws(() => resolveInputSource({ input: "" }), DigInputError);
  assert.throws(() => resolveInputSource({ input: "   " }), DigInputError);
  assert.throws(() => resolveInputSource({}), DigInputError);
});

test("resolveInputSource rejects text longer than MAX_TEXT_INPUT_LENGTH", () => {
  const longText = "あ".repeat(MAX_TEXT_INPUT_LENGTH + 1);
  assert.throws(() => resolveInputSource({ input: longText }), DigInputError);
});

test("resolveInputSource accepts text exactly at MAX_TEXT_INPUT_LENGTH", () => {
  const text = "あ".repeat(MAX_TEXT_INPUT_LENGTH);
  const result = resolveInputSource({ input: text });
  assert.equal(result.type, "text");
});

// --- 画像 ---

test("resolveInputSource accepts a valid JPEG image", () => {
  const result = resolveInputSource({ image: { data: "aGVsbG8=", mimeType: "image/jpeg" } });
  assert.deepEqual(result, { type: "image", data: "aGVsbG8=", mimeType: "image/jpeg", caption: undefined });
});

test("resolveInputSource accepts a valid PNG/WebP image", () => {
  assert.equal(resolveInputSource({ image: { data: "aGVsbG8=", mimeType: "image/png" } }).type, "image");
  assert.equal(resolveInputSource({ image: { data: "aGVsbG8=", mimeType: "image/webp" } }).type, "image");
});

test("resolveInputSource strips a data: URL prefix from image data", () => {
  const result = resolveInputSource({ image: { data: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" } });
  assert.equal(result.type, "image");
  if (result.type === "image") assert.equal(result.data, "aGVsbG8=");
});

test("resolveInputSource carries the composer text along as an image caption", () => {
  const result = resolveInputSource({ input: "このグラフの意味は？", image: { data: "aGVsbG8=", mimeType: "image/png" } });
  assert.equal(result.type, "image");
  if (result.type === "image") assert.equal(result.caption, "このグラフの意味は？");
});

test("resolveInputSource rejects an unsupported mime type", () => {
  assert.throws(
    () => resolveInputSource({ image: { data: "aGVsbG8=", mimeType: "application/pdf" } }),
    DigInputError,
  );
  assert.throws(
    () => resolveInputSource({ image: { data: "aGVsbG8=", mimeType: "image/gif" } }),
    DigInputError,
  );
});

test("resolveInputSource rejects an oversized image", () => {
  // base64は元データの約4/3の長さになるため、MAX_IMAGE_BYTESを明確に超える長さの文字列を作る。
  const oversized = "A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1000);
  assert.throws(
    () => resolveInputSource({ image: { data: oversized, mimeType: "image/jpeg" } }),
    (err: unknown) => err instanceof DigInputError && err.status === 413,
  );
});

test("resolveInputSource rejects malformed image payloads", () => {
  assert.throws(() => resolveInputSource({ image: {} }), DigInputError);
  assert.throws(() => resolveInputSource({ image: { data: "", mimeType: "image/png" } }), DigInputError);
  assert.throws(() => resolveInputSource({ image: null }), DigInputError);
});

// --- parseArticleUrl（既存機能） ---

test("parseArticleUrl accepts http/https URLs", () => {
  assert.equal(parseArticleUrl("https://example.com/a").toString(), "https://example.com/a");
});

test("parseArticleUrl rejects non-http(s) protocols", () => {
  assert.throws(() => parseArticleUrl("ftp://example.com/a"));
  assert.throws(() => parseArticleUrl("javascript:alert(1)"));
});

test("parseArticleUrl rejects empty or non-string input", () => {
  assert.throws(() => parseArticleUrl(""));
  assert.throws(() => parseArticleUrl(undefined));
  assert.throws(() => parseArticleUrl(123));
});
