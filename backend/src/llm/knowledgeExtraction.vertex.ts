import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  knowledgeExtractionDraftSchema,
  knowledgeExtractionResultSchema,
  type KnowledgeExtractionDraft,
  type KnowledgeExtractionInput,
  type KnowledgeExtractionResult,
  type KnowledgeExtractionService,
} from "./knowledgeExtraction.js";
import { getLlmProvider } from "./provider/llmProviderFactory.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import { extractJsonText } from "./jsonExtraction.js";
import type { LlmProvider } from "./provider/llmProvider.js";

// 会話が長くなりすぎた場合に備えて直近のやり取りだけをLLMへ渡す（コストとレイテンシの保守的な上限。
// ArticleAnalysisのMAX_CONTENT_LENGTHと同じ考え方）。
const MAX_CONVERSATION_TURNS = 30;

const knowledgeExtractionJsonSchema = z.toJSONSchema(knowledgeExtractionDraftSchema);

const SYSTEM_PROMPT = `あなたはDiggerのKnowledge Extractionエンジンです。

Diggerは、「興味を持ったことを深掘りし、理解したことを蓄積して、次の理解につなげるサービス」です。

あなたの役割は、会話からユーザーの理解を推測して知識を勝手に確定することではありません。
会話の中でユーザーが理解した可能性がある内容を「保存候補」として抽出してください。

厳守事項:
- 記事本文に書いてあるだけで、ユーザーが実際に触れていない内容を理解済みとして扱わないでください。
- ユーザーが質問しただけの内容（まだ答えを得ていない、あるいは疑問を投げただけ）を理解済みとして扱わないでください。
- ユーザーの言い換え、確認、関連づけなどを理解の根拠として重視してください（confidenceをhighにする主な理由）。
- 知識は、今後別の記事・別のトピックを理解するときにも再利用できる、小さな理解単位として記述してください
  （悪い例:「政策金利とは金利である」、良い例:「中央銀行が政策金利を変更すると、市場金利や銀行の貸出金利にも影響が波及しうる」）。
- 会話から理解した可能性のある内容が見つからない場合は、候補を無理に作らず空配列を返してください。

出力は指定されたJSON schemaに厳密に従ってください。`;

function truncateConversation(
  conversation: KnowledgeExtractionInput["conversation"],
): KnowledgeExtractionInput["conversation"] {
  if (conversation.length <= MAX_CONVERSATION_TURNS) return conversation;
  return conversation.slice(conversation.length - MAX_CONVERSATION_TURNS);
}

function formatConversation(conversation: KnowledgeExtractionInput["conversation"]): string {
  if (conversation.length === 0) return "（この記事についてまだ深掘りの会話はありません）";
  return conversation
    .map((turn) => `${turn.role === "user" ? "ユーザー" : "Digger"}: ${turn.content}`)
    .join("\n");
}

function formatExistingKnowledge(existingKnowledge: KnowledgeExtractionInput["existingKnowledge"]): string {
  if (!existingKnowledge || existingKnowledge.length === 0) {
    return "（このユーザーが過去に保存した理解はまだありません）";
  }
  return existingKnowledge.map((k) => `- ${k.concept}: ${k.statement}`).join("\n");
}

function buildPrompt(input: KnowledgeExtractionInput, extraInstruction?: string): string {
  const conversation = truncateConversation(input.conversation);

  const base = `以下の記事とDeep Dive会話から、ユーザーが新しく理解したと考えられる内容の保存候補を抽出してください。

# 記事情報
タイトル: ${input.source.title}
URL: ${input.source.url}
記事の要約: ${input.articleAnalysis.summary}

# 記事の前提知識（参考。これ自体を理解済みとして扱わないこと）
${input.articleAnalysis.concepts.map((c) => `- ${c.name}: ${c.description}`).join("\n") || "（なし）"}

# Deep Dive会話ログ
${formatConversation(conversation)}

# このユーザーが過去に保存した理解（重複判定用。これと実質同じ内容ならisNew=falseにする）
${formatExistingKnowledge(input.existingKnowledge)}

# 出力ルール
- candidates: 0〜5件程度。無理に件数を埋めない。
- concept: 短い名詞句（例:「政策金利」）。
- statement: 会話を通してユーザーが理解したと考えられる内容を1文で。再利用可能な粒度にする。
- evidence: なぜ「理解した可能性がある」と判断したか、会話中の具体的な根拠を短く記録する（ユーザーには常時表示されない内部情報）。
- confidence: "high"=ユーザーが自分の言葉で言い換えたり正しく関連づけたりしている / "medium"=納得しているように見えるが理解確認は十分でない / "low"=AIの説明を読んだだけで理解を裏付ける情報が少ない。
- isNew: 上記の「過去に保存した理解」と実質的に同じ内容ならfalse、新しい理解ならtrue。

指定されたJSON schemaに厳密に従ってJSON形式のみで出力してください。`;

  return extraInstruction ? `${base}\n\n${extraInstruction}` : base;
}

const RETRY_INSTRUCTION =
  "前回の出力がschemaに適合しなかったため、指定schemaに厳密に従って再生成してください。";

async function requestOnce(provider: LlmProvider, input: KnowledgeExtractionInput, extraInstruction?: string) {
  const text = await provider.generateText({
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(input, extraInstruction),
    responseJsonSchema: knowledgeExtractionJsonSchema,
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

  const result = knowledgeExtractionDraftSchema.safeParse(parsedJson);
  if (!result.success) {
    return { success: false as const, issue: `schema validation failed: ${result.error.message}` };
  }

  return { success: true as const, data: result.data };
}

function withGeneratedIds(draft: KnowledgeExtractionDraft): KnowledgeExtractionResult {
  const result = {
    candidates: draft.candidates.map((candidate) => ({ ...candidate, id: randomUUID() })),
  };
  return knowledgeExtractionResultSchema.parse(result);
}

// 実LLM版のKnowledge Extraction。provider固有(@google/genai等)のコードには一切依存せず、
// LlmProvider経由でテキストを取得し、JSON parse + zod schemaでの検証まで行う。
// idはLLMの出力に含めず、schema検証後にサービス側でrandomUUID()を付与する。
export function createVertexKnowledgeExtractionService(
  getProvider: () => LlmProvider = getLlmProvider,
): KnowledgeExtractionService {
  return {
    async extract(input) {
      const provider = getProvider();
      const providerName = process.env.LLM_PROVIDER ?? "vertex";
      const model = process.env.GEMINI_MODEL ?? "(unset)";
      const startedAt = Date.now();

      console.log("[KnowledgeExtraction] start", {
        provider: providerName,
        model,
        url: input.source.url,
        conversationLength: input.conversation.length,
      });

      const first = await requestOnce(provider, input);
      if (first.success) {
        console.log("[KnowledgeExtraction] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: false,
          candidateCount: first.data.candidates.length,
        });
        return withGeneratedIds(first.data);
      }

      console.error("[KnowledgeExtraction] validation failed, retrying once", {
        provider: providerName,
        model,
        issue: first.issue,
      });

      const retry = await requestOnce(provider, input, RETRY_INSTRUCTION);
      if (retry.success) {
        console.log("[KnowledgeExtraction] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: true,
          candidateCount: retry.data.candidates.length,
        });
        return withGeneratedIds(retry.data);
      }

      console.error("[KnowledgeExtraction] failed after retry", {
        provider: providerName,
        model,
        durationMs: Date.now() - startedAt,
        issue: retry.issue,
      });
      throw new LlmProviderError(
        `Knowledge Extractionの生成結果がschemaに適合しませんでした: ${retry.issue}`,
        "empty_response",
      );
    },
  };
}

export const vertexKnowledgeExtractionService: KnowledgeExtractionService =
  createVertexKnowledgeExtractionService();
