import { z } from "zod";
import { deepDiveResponseSchema, type DeepDiveInput, type DeepDiveService } from "./deepDive.js";
import type { ArticleAnalysis } from "./articleAnalysis.js";
import type { ConversationTurn } from "./conversation.js";
import type { UserKnowledge } from "./personalizedAnalysis.js";
import { getLlmProvider } from "./provider/llmProviderFactory.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import { extractJsonText } from "./jsonExtraction.js";
import type { LlmProvider } from "./provider/llmProvider.js";

// 会話履歴を無制限にプロンプトへ積み上げないための安全弁。高度な要約はまだ行わず、
// 直近N件だけを使う単純な方式（古い発言から落とす）。
const MAX_HISTORY_MESSAGES = 20;

const deepDiveJsonSchema = z.toJSONSchema(deepDiveResponseSchema);

const SYSTEM_PROMPT = `あなたはDiggerのDeep Diveアシスタントです。

Diggerは、「興味を持ったことを深掘りし、理解したことを蓄積し、次の理解につなげるサービス」です。

あなたの役割は質問に答えることだけではありません。ユーザーが現在読んでいる記事やテーマを一段深く理解できるように支援してください。

回答方針:
- 初学者にも分かる言葉で説明する
- まず質問に直接答える
- 必要なら背景や仕組みを補足する
- 専門用語を新しく使う場合は簡単に説明する
- ArticleAnalysis（記事の解析結果）との関係を保つ
- 会話履歴を踏まえ、同じ説明を無駄に繰り返さない
- ユーザーがすでに理解している知識が与えられている場合は、それを前提に一段先を説明する
- 不明なことを断定しない
- 記事や与えられたコンテキストだけで判断できない場合はその旨を明示する
- 過剰に長い回答にしない
- さらに理解が進みそうな問いを提案する

出力は指定されたJSON schemaに厳密に従ってください。`;

function truncateHistory(history: ConversationTurn[]): ConversationTurn[] {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  return history.slice(history.length - MAX_HISTORY_MESSAGES);
}

function formatArticleContext(analysis: ArticleAnalysis): string {
  const concepts =
    analysis.concepts.map((c) => `- ${c.name}（${c.importance}）: ${c.description}`).join("\n") || "（なし）";
  const entities =
    analysis.entities.map((e) => `- ${e.name}（${e.type}）${e.description ? `: ${e.description}` : ""}`).join("\n") ||
    "（なし）";
  const connections = analysis.connections.map((c) => `- ${c.topic}: ${c.relation}`).join("\n") || "（なし）";

  return `## 記事の要約
${analysis.summary}

## なぜ重要か
${analysis.whyItMatters}

## 前提知識
${concepts}

## 関連する人物・組織など
${entities}

## 関連テーマ
${connections}`;
}

function formatConversationHistory(history: ConversationTurn[]): string {
  if (history.length === 0) return "（まだ会話はありません。これが最初の質問です。）";
  return truncateHistory(history)
    .map((turn) => `${turn.role === "user" ? "User" : "Digger"}: ${turn.content}`)
    .join("\n");
}

function formatUserKnowledge(userKnowledge: UserKnowledge[] | undefined): string {
  if (!userKnowledge || userKnowledge.length === 0) return "（ユーザーの理解履歴はまだありません。）";
  return userKnowledge.map((k) => `- ${k.concept}: ${k.statement}`).join("\n");
}

function buildPrompt(input: DeepDiveInput, extraInstruction?: string): string {
  const base = `あなたは以下の記事についてユーザーの深掘りを支援しています。あなたは一般的な雑談チャットではなく、この記事・テーマを理解するための専用家庭教師です。

# 記事コンテキスト（Article Analysis）
${formatArticleContext(input.articleAnalysis)}

# これまでの会話
${formatConversationHistory(input.conversationHistory)}

# ユーザーがすでに理解していること
${formatUserKnowledge(input.userKnowledge)}

# 今回の質問
${input.question}

# 出力ルール
- answer: まず質問に直接答え、必要なら背景や仕組みを補足する。3〜8段落以内（必要なら箇条書き可、Markdownは複雑にしすぎない）。専門用語を新しく使う場合は簡単に説明する。会話履歴で既に説明した内容を無駄に繰り返さない。記事やコンテキストだけで判断できない場合はその旨を明示し、不明なことを断定しない。
- relatedConcepts: 今回の質問を理解する上で関連する概念を2〜5件。nameは概念名、relationは「今回の質問とどう関係するか」の説明（単なるキーワード列挙にしない）。
- suggestedFollowUps: 次に掘ると理解が一段深まる質問を2〜4件。今回の質問とほぼ同じ内容を言い換えただけの候補は避ける。

指定されたJSON schemaに厳密に従ってJSON形式のみで出力してください。`;

  return extraInstruction ? `${base}\n\n${extraInstruction}` : base;
}

const RETRY_INSTRUCTION =
  "前回の出力がschemaに適合しなかったため、指定schemaに厳密に従って再生成してください。";

async function requestOnce(provider: LlmProvider, input: DeepDiveInput, extraInstruction?: string) {
  const text = await provider.generateText({
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(input, extraInstruction),
    responseJsonSchema: deepDiveJsonSchema,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonText(text));
  } catch (err) {
    return { success: false as const, issue: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const result = deepDiveResponseSchema.safeParse(parsedJson);
  if (!result.success) {
    return { success: false as const, issue: `schema validation failed: ${result.error.message}` };
  }

  return { success: true as const, data: result.data };
}

// 実LLM版のDeep Dive。provider固有(@google/genai等)のコードには一切依存せず、
// LlmProvider経由でテキストを取得し、JSON parse + zod schemaでの検証まで行う。
// LLMの出力は信頼せず、必ず deepDiveResponseSchema で再検証してから返す。
//
// getProviderの遅延解決・フェイクprovider注入はArticle Analysis（articleAnalysis.vertex.ts）
// と同じ理由・同じパターン。
export function createVertexDeepDiveService(
  getProvider: () => LlmProvider = getLlmProvider,
): DeepDiveService {
  return {
    async ask(input) {
      const provider = getProvider();
      const providerName = process.env.LLM_PROVIDER ?? "vertex";
      const model = process.env.GEMINI_MODEL ?? "(unset)";
      const startedAt = Date.now();

      console.log("[DeepDive] start", {
        provider: providerName,
        model,
        conversationLength: input.conversationHistory.length,
      });

      const first = await requestOnce(provider, input);
      if (first.success) {
        console.log("[DeepDive] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: false,
        });
        return first.data;
      }

      console.error("[DeepDive] validation failed, retrying once", {
        provider: providerName,
        model,
        issue: first.issue,
      });

      const retry = await requestOnce(provider, input, RETRY_INSTRUCTION);
      if (retry.success) {
        console.log("[DeepDive] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: true,
        });
        return retry.data;
      }

      console.error("[DeepDive] failed after retry", {
        provider: providerName,
        model,
        durationMs: Date.now() - startedAt,
        issue: retry.issue,
      });
      throw new LlmProviderError(
        `Deep Diveの生成結果がschemaに適合しませんでした: ${retry.issue}`,
        "empty_response",
      );
    },
  };
}

export const vertexDeepDiveService: DeepDiveService = createVertexDeepDiveService();
