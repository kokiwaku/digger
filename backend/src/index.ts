import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { pingDatabase } from "./db.js";
import { buildDigResult, resolveInputSource, DigInputError } from "./dig.js";
import { ArticleFetchError } from "./articleFetcher.js";
import { buildDeepDiveResponse, parseDeepDiveInput } from "./deepDive.js";
import { callLlmTest, parseLlmTestInput } from "./llmTest.js";
import {
  parseExtractKnowledgeRequest,
  buildKnowledgeExtractionResponse,
  parseSaveKnowledgeRequest,
  saveCandidatesAsKnowledge,
  fetchUserKnowledge,
  fetchUnderstandingMap,
  refreshAndFetchUnderstandingMap,
} from "./knowledgeApi.js";
import {
  parseExtractMemoryRequest,
  buildMemoryExtractionResponse,
  parseSaveMemoryRequest,
  saveMemoryItems,
  fetchMemoryItems,
} from "./memoryApi.js";
import { LlmProviderError, toSafeApiResponse } from "./llm/provider/llmProviderError.js";

const PORT = Number(process.env.PORT ?? 8787);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
// 画像はbase64化するとバイナリの約4/3のサイズになる（MAX_IMAGE_BYTES=8MB相当で約10.9MB）。
// JSONの構造分・余裕を見て15MBを/api/digのボディ上限にする（他のAPIはテキストのみで
// 十分小さいため、この上限は/api/digにだけ適用する）。
const DIG_BODY_LIMIT_BYTES = 15 * 1024 * 1024;

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

app.post(
  "/api/dig",
  bodyLimit({
    maxSize: DIG_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: "リクエストサイズが大きすぎます" }, 413),
  }),
  async (c) => {
    const body = await c.req.json().catch(() => null);

    let inputSource;
    try {
      inputSource = resolveInputSource(body);
    } catch (err) {
      if (err instanceof DigInputError) return c.json({ error: err.message }, err.status);
      const message = err instanceof Error ? err.message : "invalid request";
      return c.json({ error: message }, 400);
    }

    try {
      const result = await buildDigResult(inputSource);
      return c.json(result);
    } catch (err) {
      if (err instanceof ArticleFetchError) {
        return c.json({ error: err.message }, err.status);
      }
      if (err instanceof DigInputError) {
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
      const message = err instanceof Error ? err.message : "解析に失敗しました";
      return c.json({ error: message }, 502);
    }
  },
);

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

// Memory Extraction: Knowledge Extractionを、保存対象がKnowledgeに限定されない
// より一般的な形（knowledge/preference/candidate/decision/open_question）へ広げたもの。
// 既存の/api/knowledge/*は後方互換のためそのまま残し、frontendはこちらへ移行する。
app.post("/api/memory/extract", async (c) => {
  const body = await c.req.json().catch(() => null);

  let request;
  try {
    request = parseExtractMemoryRequest(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return c.json({ error: message }, 400);
  }

  try {
    const result = await buildMemoryExtractionResponse(request);
    return c.json(result);
  } catch (err) {
    if (err instanceof LlmProviderError) {
      console.error("[api/memory/extract] Memory Extraction provider error", {
        code: err.code,
        message: err.message,
        cause: err.cause,
      });
      const { status, message: safeMessage } = toSafeApiResponse(err);
      return c.json({ error: safeMessage }, status);
    }
    const message = err instanceof Error ? err.message : "保存候補の抽出に失敗しました";
    return c.json({ error: message }, 502);
  }
});

app.post("/api/memory/save", async (c) => {
  const body = await c.req.json().catch(() => null);

  let request;
  try {
    request = parseSaveMemoryRequest(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return c.json({ error: message }, 400);
  }

  try {
    const result = await saveMemoryItems(request);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存に失敗しました";
    console.error("[api/memory/save] error", { message });
    return c.json({ error: message }, 502);
  }
});

app.get("/api/memory", async (c) => {
  try {
    const items = await fetchMemoryItems();
    return c.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "取得に失敗しました";
    console.error("[api/memory] error", { message });
    return c.json({ error: message }, 502);
  }
});

// Topic/Concept/Knowledgeモデル（understandingStructure.ts）用。既存のGET /api/knowledgeとは
// 独立した新しいエンドポイントで、現在のTopic階層・Concept・ConceptRelationを返す。
// 読み取り専用（lazy migrationやLLM呼び出しは行わない。それらはPOST /refresh側の責務）。
app.get("/api/understanding-map", async (c) => {
  try {
    const map = await fetchUnderstandingMap();
    return c.json(map);
  } catch (err) {
    const message = err instanceof Error ? err.message : "理解構造の取得に失敗しました";
    console.error("[api/understanding-map] error", { message });
    return c.json({ error: message }, 502);
  }
});

// 未移行のKnowledgeのConcept化と、未分類のConceptのTopic分類（LLM呼び出しを伴う、
// 相対的に重い処理）を明示的に実行する。GET /api/understanding-mapを「開くだけ」で
// この重い処理が走らないよう、副作用を伴う操作は別エンドポイントに分離している。
app.post("/api/understanding-map/refresh", async (c) => {
  try {
    const map = await refreshAndFetchUnderstandingMap();
    return c.json(map);
  } catch (err) {
    const message = err instanceof Error ? err.message : "理解構造の更新に失敗しました";
    console.error("[api/understanding-map/refresh] error", { message });
    return c.json({ error: message }, 502);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`digger-backend listening on http://localhost:${info.port}`);
});
