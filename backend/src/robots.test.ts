import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobotsTxt, isPathAllowed, ensureAllowedByRobots } from "./robots.js";
import { ArticleFetchError } from "./errors.js";

test("isPathAllowed: Disallow: / blocks every path", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /");
  assert.equal(isPathAllowed(groups.get("*") ?? [], "/anything"), false);
});

test("isPathAllowed: unmatched path defaults to allowed", () => {
  const groups = parseRobotsTxt("User-agent: digger\nDisallow: /private/");
  const rules = groups.get("digger") ?? [];
  assert.equal(isPathAllowed(rules, "/public"), true);
  assert.equal(isPathAllowed(rules, "/private/x"), false);
});

test("isPathAllowed: a more specific Allow overrides a shorter Disallow", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /a/\nAllow: /a/b\n");
  const rules = groups.get("*") ?? [];
  assert.equal(isPathAllowed(rules, "/a/b/c"), true);
  assert.equal(isPathAllowed(rules, "/a/x"), false);
});

test("parseRobotsTxt keeps separate rule sets per user-agent group", () => {
  const groups = parseRobotsTxt(
    ["User-agent: digger", "Disallow: /no-bots/", "", "User-agent: *", "Allow: /"].join("\n"),
  );
  assert.equal(isPathAllowed(groups.get("digger") ?? [], "/no-bots/x"), false);
  assert.equal(isPathAllowed(groups.get("*") ?? [], "/no-bots/x"), true);
});

test("ensureAllowedByRobots throws a 403 ArticleFetchError when disallowed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("User-agent: *\nDisallow: /blocked", { status: 200 })) as typeof fetch;

  try {
    await assert.rejects(
      () => ensureAllowedByRobots(new URL("https://example.com/blocked/page"), "Digger/0.1"),
      (err: unknown) => err instanceof ArticleFetchError && err.status === 403,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ensureAllowedByRobots allows access when robots.txt is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    await assert.doesNotReject(() =>
      ensureAllowedByRobots(new URL("https://example.com/blocked/page"), "Digger/0.1"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
