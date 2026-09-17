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

Diggerは1回の回答でテーマ全体を説明し切るサービスではありません。ユーザーとの会話の往復を通じて理解を深めていくことを前提にしてください。「詳しい回答」より「今の疑問にちょうどよく答える」ことを優先してください。

回答方針:
- 初学者にも分かる言葉で説明する
- まず質問に直接答える
- 質問された範囲を超えて説明を広げすぎない（周辺知識を網羅しようとしない）
- 専門用語を新しく使う場合は簡単に説明する
- ArticleAnalysis（記事の解析結果）との関係を保つ
- 会話履歴を踏まえ、同じ説明を無駄に繰り返さない
- ユーザーがすでに理解している知識が与えられている場合は、それを前提に一段先を説明し、繰り返し説明しない
- 不明なことを断定しない
- 記事や与えられたコンテキストだけで判断できない場合はその旨を明示する
- 「さらに詳しく言うと〜」のように自分から説明を増やしすぎない。次の疑問が自然に生まれる余白を残す
- 短くするために情報を曖昧にしない。必要十分な回答を優先する

## 質問タイプに応じた回答量の目安

質問の性質に応じて、回答の長さを変えてください。長さそのものよりも「今の疑問にちょうどよく答えているか」を優先してください。

- **単純な事実質問**（例:「MI6の起源は？」「この人は誰？」「これはいつ始まった？」）: 150〜300文字程度。直接的な答え＋必要なら補足1〜2点。不要な背景説明まで広げない。
- **因果関係・仕組みの質問**（例:「なぜ利上げすると円高になりやすい？」「なぜこの国同士は対立している？」「これは経済にどう影響する？」）: 300〜500文字程度。結論→因果関係→必要な補足、という構成。3〜5段落程度を上限の目安にする。
- **詳細要求**（ユーザーが「詳しく」「もっと深掘りして」「歴史から教えて」「具体例も含めて」などと明示的に求めた場合のみ）: 上記の文字数・段落数の目安にとらわれず、求められた分だけ詳しく説明してよい。

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

// 関連Knowledgeがある場合のみプロンプトに追加する（無ければセクションごと省略）。
// 「毎回答で無理に過去の理解へ言及する」ような不自然な振る舞いを避けるため、
// あくまで参考情報として渡すだけで、言及を強制する指示は書かない。
function formatUserKnowledgeSection(userKnowledge: UserKnowledge[] | undefined): string {
  if (!userKnowledge || userKnowledge.length === 0) return "";

  const list = userKnowledge.map((k) => `- ${k.concept}: ${k.statement}`).join("\n");
  return `

# ユーザーが過去の会話で理解したと確認済みの内容（今回の質問に関連しそうなものだけを抜粋）
${list}

上記は、このユーザーが過去の会話で理解したと確認済みの内容です。同じ内容を初歩から繰り返し説明する必要はありません。必要に応じて、これを前提として説明を進めてください。関連性が高い場合は過去の理解とのつながりを自然に示して構いませんが、「以前あなたは○○を理解しました」のような言い回しを毎回答で繰り返す必要はありません。今回の質問と関連が薄い場合は無理に触れず、通常どおり説明してください。`;
}

function buildPrompt(input: DeepDiveInput, extraInstruction?: string): string {
  const base = `あなたは以下の記事についてユーザーの深掘りを支援しています。あなたは一般的な雑談チャットではなく、この記事・テーマを理解するための専用家庭教師です。

# 記事コンテキスト（Article Analysis）
${formatArticleContext(input.articleAnalysis)}

# これまでの会話
${formatConversationHistory(input.conversationHistory)}
${formatUserKnowledgeSection(input.userKnowledge)}

# 今回の質問
${input.question}

# 出力ルール
- answer: まず質問に直接答える。今回の質問が「単純な事実質問」「因果関係・仕組みの質問」「詳細要求」のどれに当たるかを判断し、システムプロンプトの「質問タイプに応じた回答量の目安」に従って長さを調整する（判断に迷う場合は「因果関係・仕組みの質問」の目安を使う）。質問された範囲を超えて周辺知識や背景まで広げすぎないこと。ユーザーが既に理解済みの内容として渡されているものがあれば、それは初歩から繰り返し説明しない。専門用語を新しく使う場合は簡単に説明する。会話履歴で既に説明した内容を無駄に繰り返さない。「さらに詳しく言うと〜」のように自分から話を広げすぎず、次の疑問が自然に生まれる余白を残す（ユーザーが詳細を明示的に求めてきた場合のみ、そのとき詳しく説明すればよい）。記事やコンテキストだけで判断できない場合はその旨を明示し、不明なことを断定しない。短くするために情報を曖昧にせず、質問への直接的な回答に必要な情報は省略しないこと。
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
