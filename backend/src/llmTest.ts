import { z } from "zod";
import { getLlmProvider } from "./llm/provider/llmProviderFactory.js";

// 開発用の疎通確認API (`POST /api/llm/test`) 専用のロジック。
// Diggerの業務ロジック（ArticleAnalysis等）はまだ関与しない。
const llmTestRequestSchema = z.object({
  message: z.string().min(1),
});

const SYSTEM_PROMPT =
  "あなたはDiggerという、ユーザーの理解を深めるサービスのアシスタントです。簡潔で正確な日本語で回答してください。";

export function parseLlmTestInput(body: unknown): string {
  const result = llmTestRequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "invalid request");
  }
  return result.data.message;
}

export async function callLlmTest(message: string): Promise<string> {
  const provider = getLlmProvider();
  return provider.generateText({ systemPrompt: SYSTEM_PROMPT, prompt: message });
}
