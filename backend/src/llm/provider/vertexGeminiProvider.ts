import { GoogleGenAI } from "@google/genai";
import { LlmProviderError } from "./llmProviderError.js";
import type { GenerateTextInput, LlmProvider } from "./llmProvider.js";

const REQUEST_TIMEOUT_MS = 30_000;

const ADC_FAILURE_PATTERN =
  /could not load the default credentials|application default credentials|reauthentication|invalid_grant/i;

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new LlmProviderError(
      `Vertex AI の環境変数が不足しています: ${name}`,
      "config_missing",
    );
  }
  return value;
}

function extractHttpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const candidate = err as { status?: unknown; httpStatusCode?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.httpStatusCode === "number") return candidate.httpStatusCode;
  return undefined;
}

// Vertex AI呼び出しで発生し得るエラーを、原因ごとのLlmProviderErrorに分類する。
// ネットワークを一切使わない純粋関数なので、単体テストで直接検証できる。
export function classifyVertexError(err: unknown, modelName?: string): LlmProviderError {
  if (err instanceof LlmProviderError) return err;

  if (err instanceof Error && err.name === "AbortError") {
    return new LlmProviderError("Vertex AI への呼び出しがタイムアウトしました", "timeout", err);
  }

  const message = err instanceof Error ? err.message : String(err);
  const status = extractHttpStatus(err);

  if (status === 401 || status === 403) {
    return new LlmProviderError(
      `Vertex AI の認証/権限エラーです (HTTP ${status}): ${message}`,
      "auth_failed",
      err,
    );
  }

  if (status === 404) {
    return new LlmProviderError(
      `指定されたモデルが見つかりません: ${modelName ?? "(unknown)"} (HTTP 404): ${message}`,
      "invalid_model",
      err,
    );
  }

  if (ADC_FAILURE_PATTERN.test(message)) {
    return new LlmProviderError(
      `Application Default Credentials の読み込みに失敗しました: ${message}`,
      "auth_failed",
      err,
    );
  }

  return new LlmProviderError(`Vertex AI の呼び出しに失敗しました: ${message}`, "api_error", err);
}

// Google Cloud Vertex AI上のGemini呼び出し。provider固有(@google/genai)のコードは
// このファイルに閉じ込め、呼び出し側にはLlmProviderインターフェースだけを見せる。
export class VertexGeminiProvider implements LlmProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor() {
    const project = readRequiredEnv("GCP_PROJECT_ID");
    const location = readRequiredEnv("GCP_LOCATION");
    this.model = readRequiredEnv("GEMINI_MODEL");

    // ローカル/Docker開発ではApplication Default Credentials（`gcloud auth application-default
    // login`で発行される認証情報）を利用する想定。APIキー等は渡さず、SDKのデフォルトの
    // 認証解決に任せる。
    this.client = new GoogleGenAI({ vertexai: true, project, location });
  }

  async generateText(input: GenerateTextInput): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: input.prompt,
        config: {
          systemInstruction: input.systemPrompt,
          abortSignal: controller.signal,
        },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new LlmProviderError("Vertex AI から有効な応答が得られませんでした", "empty_response");
      }
      return text;
    } catch (err) {
      throw classifyVertexError(err, this.model);
    } finally {
      clearTimeout(timeout);
    }
  }
}
