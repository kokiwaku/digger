import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { pingDatabase } from "./db.js";
import { buildDigResult, parseArticleUrl } from "./dig.js";
import { ArticleFetchError } from "./articleFetcher.js";
import { buildDeepDiveResponse, parseDeepDiveInput } from "./deepDive.js";
import { callLlmTest, parseLlmTestInput } from "./llmTest.js";
import {
  parseExtractKnowledgeRequest,
  buildKnowledgeExtractionResponse,
  parseSaveKnowledgeRequest,
  saveCandidatesAsKnowledge,
  fetchUserKnowledge,
} from "./knowledgeApi.js";
import { LlmProviderError, toSafeApiResponse } from "./llm/provider/llmProviderError.js";
import type { DigRequest } from "./types.js";

const PORT = Number(process.env.PORT ?? 8787);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

const app = new Hono();

app.use("/api/*", cors({ origin: FRONTEND_ORIGIN }));

app.get("/api/health", (c) => {
  return c.json({ status: "ok", service: "digger-backend" });
});

app.get("/api/health/db", async (c) => {
  try {
    await pingDatabase();
    return c.json({ status: "ok", db: "connected" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return c.json({ status: "error", db: "disconnected", message }, 503);
  }
});

app.post("/api/dig", async (c) => {
  const body = await c.req.json<Partial<DigRequest>>().catch(() => null);

  let url: URL;
  try {
    url = parseArticleUrl(body?.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return c.json({ error: message }, 400);
  }

  try {
    const result = await buildDigResult(url);
    return c.json(result);
  } catch (err) {
    if (err instanceof ArticleFetchError) {
      return c.json({ error: err.message }, err.status);
    }
    if (err instanceof LlmProviderError) {
      console.error("[api/dig] Article Analysis provider error", {
        code: err.code,
        message: err.message,
        cause: err.cause,
      });
      const { status, message: safeMessage } = toSafeApiResponse(err);
      return c.json({ error: safeMessage }, status);
    }
    const message = err instanceof Error ? err.message : "記事の解析に失敗しました";
    return c.json({ error: message }, 502);
  }
});

app.post("/api/deep-dive", async (c) => {
  const body = await c.req.json().catch(() => null);

  let input;
  try {
    input = parseDeepDiveInput(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return c.json({ error: message }, 400);
  }

  try {
    const result = await buildDeepDiveResponse(input);
    return c.json(result);
  } catch (err) {
    if (err instanceof LlmProviderError) {
      console.error("[api/deep-dive] Deep Dive provider error", {
        code: err.code,
        message: err.message,
        cause: err.cause,
      });
      const { status, message: safeMessage } = toSafeApiResponse(err);
      return c.json({ error: safeMessage }, status);
    }
    const message = err instanceof Error ? err.message : "深掘り回答の生成に失敗しました";
    return c.json({ error: message }, 502);
  }
});

// 開発用の疎通確認API。Diggerの業務ロジックはまだ関与しない。
app.post("/api/llm/test", async (c) => {
  const body = await c.req.json().catch(() => null);

  let message: string;
  try {
    message = parseLlmTestInput(body);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "invalid request";
    return c.json({ error: errorMessage }, 400);
  }

  try {
    const response = await callLlmTest(message);
    return c.json({ response });
  } catch (err) {
    if (err instanceof LlmProviderError) {
      console.error("[api/llm/test] LLM provider error", {
        code: err.code,
        message: err.message,
        cause: err.cause,
      });
      const { status, message: safeMessage } = toSafeApiResponse(err);
      return c.json({ error: safeMessage }, status);
    }
    console.error("[api/llm/test] unexpected error", err);
    return c.json({ error: "予期しないエラーが発生しました" }, 500);
  }
});

app.post("/api/knowledge/extract", async (c) => {
  const body = await c.req.json().catch(() => null);

  let request;
  try {
    request = parseExtractKnowledgeRequest(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return c.json({ error: message }, 400);
  }

  try {
    const result = await buildKnowledgeExtractionResponse(request);
    return c.json(result);
  } catch (err) {
    if (err instanceof LlmProviderError) {
      console.error("[api/knowledge/extract] Knowledge Extraction provider error", {
        code: err.code,
        message: err.message,
        cause: err.cause,
      });
      const { status, message: safeMessage } = toSafeApiResponse(err);
      return c.json({ error: safeMessage }, status);
    }
    const message = err instanceof Error ? err.message : "知識抽出に失敗しました";
    return c.json({ error: message }, 502);
  }
});

app.post("/api/knowledge/save", async (c) => {
  const body = await c.req.json().catch(() => null);

  let request;
  try {
    request = parseSaveKnowledgeRequest(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return c.json({ error: message }, 400);
  }

  try {
    const result = await saveCandidatesAsKnowledge(request);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "知識の保存に失敗しました";
    console.error("[api/knowledge/save] error", { message });
    return c.json({ error: message }, 502);
  }
});

app.get("/api/knowledge", async (c) => {
  try {
    const knowledge = await fetchUserKnowledge();
    return c.json({ knowledge });
  } catch (err) {
    const message = err instanceof Error ? err.message : "知識の取得に失敗しました";
    console.error("[api/knowledge] error", { message });
    return c.json({ error: message }, 502);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`digger-backend listening on http://localhost:${info.port}`);
});
