import { z } from "zod";
import {
  knowledgeTopicResultSchema,
  type KnowledgeTopicInput,
  type KnowledgeTopicResult,
  type KnowledgeTopicService,
} from "./knowledgeTopic.js";
import { getLlmProvider } from "./provider/llmProviderFactory.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import { extractJsonText } from "./jsonExtraction.js";
import type { LlmProvider } from "./provider/llmProvider.js";

const knowledgeTopicJsonSchema = z.toJSONSchema(knowledgeTopicResultSchema);

const SYSTEM_PROMPT = `あなたはDiggerの「自分の理解」ページ用のトピック分類エンジンです。

Diggerは、ユーザーが保存した理解（Knowledge）を「自分の理解が少しずつ育っている」と感じられる形で見せることを目指しています。そのための一つの見せ方が、Knowledgeをテーマごとの階層（トピック）に分けて表示することです。

役割:
- 与えられたKnowledge（concept/statement）それぞれに、1〜3階層のトピックパス（大分類→中分類→小分類）を付与してください。
- 深すぎる階層は作らないでください（最大3階層）。1〜2階層で十分な場合は無理に3階層にしないでください。
- 既存のトピックパス一覧が与えられている場合、意味的に同じテーマには同じ名前を再利用してください（表記揺れを避けるため）。ただし無理に既存に当てはめる必要はありません。
- トピック名は短い日本語の名詞句にしてください（例:「経済」「金融政策」「政策金利」「国際情勢」「安全保障」）。

出力は指定されたJSON schemaに厳密に従ってください。`;

function formatExistingTopicPaths(paths: KnowledgeTopicInput["existingTopicPaths"]): string {
  if (paths.length === 0) return "（まだ既存のトピックはありません）";
  return paths.map((path) => `- ${path.join(" > ")}`).join("\n");
}

function buildPrompt(input: KnowledgeTopicInput, extraInstruction?: string): string {
  const itemsList = input.items.map((item) => `- [id: ${item.id}] ${item.concept}: ${item.statement}`).join("\n");

  const base = `以下のKnowledge一覧それぞれに、トピックパスを付与してください。

# 分類対象のKnowledge
${itemsList}

# 既存のトピックパス一覧（参考。同じテーマには同じ名前を再利用してよい）
${formatExistingTopicPaths(input.existingTopicPaths)}

# 出力ルール
- assignments: 分類対象のKnowledge全件について、idとpath（1〜3階層の配列。例:["経済","金融政策","政策金利"]）を1件ずつ返す。
- 全てのidに対して必ず1件のassignmentを返すこと（省略しない）。

指定されたJSON schemaに厳密に従ってJSON形式のみで出力してください。`;

  return extraInstruction ? `${base}\n\n${extraInstruction}` : base;
}

const RETRY_INSTRUCTION =
  "前回の出力がschemaに適合しなかったため、指定schemaに厳密に従って再生成してください。全てのidに対してassignmentを含めてください。";

async function requestOnce(provider: LlmProvider, input: KnowledgeTopicInput, extraInstruction?: string) {
  const text = await provider.generateText({
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(input, extraInstruction),
    responseJsonSchema: knowledgeTopicJsonSchema,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonText(text));
  } catch (err) {
    return {
      success: false as const,
      issue: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = knowledgeTopicResultSchema.safeParse(parsedJson);
  if (!result.success) {
    return { success: false as const, issue: `schema validation failed: ${result.error.message}` };
  }

  return { success: true as const, data: result.data };
}

// 実LLM版のKnowledge Topic分類。provider固有のコードには依存せず、LlmProvider経由でテキストを
// 取得し、JSON parse + zod schemaでの検証まで行う。1回だけ再試行するパターンは他の実LLM
// サービス（Article Analysis等）と同じ。
export function createVertexKnowledgeTopicService(
  getProvider: () => LlmProvider = getLlmProvider,
): KnowledgeTopicService {
  return {
    async classify(input): Promise<KnowledgeTopicResult> {
      const provider = getProvider();
      const providerName = process.env.LLM_PROVIDER ?? "vertex";
      const model = process.env.GEMINI_MODEL ?? "(unset)";
      const startedAt = Date.now();

      console.log("[KnowledgeTopic] start", {
        provider: providerName,
        model,
        itemCount: input.items.length,
      });

      const first = await requestOnce(provider, input);
      if (first.success) {
        console.log("[KnowledgeTopic] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: false,
        });
        return first.data;
      }

      console.error("[KnowledgeTopic] validation failed, retrying once", {
        provider: providerName,
        model,
        issue: first.issue,
      });

      const retry = await requestOnce(provider, input, RETRY_INSTRUCTION);
      if (retry.success) {
        console.log("[KnowledgeTopic] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: true,
        });
        return retry.data;
      }

      console.error("[KnowledgeTopic] failed after retry", {
        provider: providerName,
        model,
        durationMs: Date.now() - startedAt,
        issue: retry.issue,
      });
      throw new LlmProviderError(
        `Knowledge Topic分類の結果がschemaに適合しませんでした: ${retry.issue}`,
        "empty_response",
      );
    },
  };
}

export const vertexKnowledgeTopicService: KnowledgeTopicService = createVertexKnowledgeTopicService();
