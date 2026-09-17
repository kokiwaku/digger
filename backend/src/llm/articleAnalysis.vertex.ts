import { z } from "zod";
import { articleAnalysisSchema, type ArticleAnalysisInput, type ArticleAnalysisService } from "./articleAnalysis.js";
import { getLlmProvider } from "./provider/llmProviderFactory.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import { extractJsonText } from "./jsonExtraction.js";
import type { LlmProvider } from "./provider/llmProvider.js";

// 記事本文をそのまま無制限にLLMへ送らないための安全弁。トークン数ではなく文字数で単純に
// 制御する（過剰な前処理はしない）。Gemini 2.5 Flash等のコンテキストウィンドウそのものは
// 十分大きいが、コストとレイテンシを抑えるための保守的な上限として文字数を区切っている。
const MAX_CONTENT_LENGTH = 12_000;

const articleAnalysisJsonSchema = z.toJSONSchema(articleAnalysisSchema);

const SYSTEM_PROMPT = `あなたはDiggerのArticle Analysisエンジンです。

Diggerは、「興味を持ったことを深掘りし、理解したことを蓄積して、次の理解につなげるサービス」です。

あなたの役割は単なる記事要約ではありません。記事を理解するために、以下を整理してください。

- 何が起きたのか
- なぜ重要なのか
- どの前提知識が必要なのか
- どのテーマとつながっているのか
- 次にどんな疑問を掘ると理解が深まるのか

初心者にも分かる表現を使ってください。
記事本文に根拠のない具体的事実を勝手に追加しないでください。
記事だけでは判断できない内容は断定しないでください。
出力は指定されたJSON schemaに厳密に従ってください。`;

function truncateContent(content: string): string {
  if (content.length <= MAX_CONTENT_LENGTH) return content;
  return `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n（以降は文字数上限のため省略）`;
}

function buildPrompt(input: ArticleAnalysisInput, extraInstruction?: string): string {
  const content = truncateContent(input.content);

  const base = `以下の記事を解析してください。

# 記事情報
タイトル: ${input.title}
URL: ${input.url}

# 記事本文
${content}

# 出力ルール
- summary: 最大3文で記事内容を簡潔に説明する日本語の要約。見出しの言い換えだけにしないこと。ユーザーはこの3文だけをまず読むため、簡潔さを優先する。
- whyItMatters: 最大3文。「何が起きたか」の繰り返しではなく、なぜこの出来事・テーマを知る意味があるのかを説明する。ユーザーの日常・社会・経済・技術等への影響が記事から合理的に説明できる場合は含めてよいが、根拠がない場合は誇張しない。
- concepts: 記事を理解するために必要な前提知識を3〜6件。単なるキーワード列挙にしない（悪い例: 「東京」「9月」「会見」、良い例: 「政策金利」「中央銀行」「為替」）。descriptionは初学者向けに1〜2文の短い説明にする。importanceは"required"（これを知らないと記事の重要部分を理解しづらい）または"helpful"（知っていると理解が深まる）のいずれか。
- entities: 記事理解に重要な人物・組織・場所・出来事のみ。大量に列挙しない。
- connections: 記事のテーマと、より大きな社会・経済・技術等のテーマとの関係。記事本文から大きく逸脱した推測的な関連付けは避ける。
- deepDiveQuestions: ユーザーが次に質問すると理解が一段深まる問いを最大4件。単純な事実確認だけでなく「なぜ？」「どういう仕組み？」「以前と何が違う？」「誰にどう影響する？」を優先する。最初の1件は他より優先して提示すべき、最も理解を深める問いにする。

指定されたJSON schemaに厳密に従ってJSON形式のみで出力してください。`;

  return extraInstruction ? `${base}\n\n${extraInstruction}` : base;
}

const RETRY_INSTRUCTION =
  "前回の出力がschemaに適合しなかったため、指定schemaに厳密に従って再生成してください。";

async function requestOnce(provider: LlmProvider, input: ArticleAnalysisInput, extraInstruction?: string) {
  const text = await provider.generateText({
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(input, extraInstruction),
    responseJsonSchema: articleAnalysisJsonSchema,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonText(text));
  } catch (err) {
    return { success: false as const, issue: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const result = articleAnalysisSchema.safeParse(parsedJson);
  if (!result.success) {
    return { success: false as const, issue: `schema validation failed: ${result.error.message}` };
  }

  return { success: true as const, data: result.data };
}

// 実LLM版のArticle Analysis。provider固有(@google/genai等)のコードには一切依存せず、
// LlmProvider経由でテキストを取得し、JSON parse + zod schemaでの検証まで行う。
// LLMの出力は信頼せず、必ず articleAnalysisSchema で再検証してから返す。
//
// getProviderは呼び出し時（analyze()実行時）まで解決を遅延させる。デフォルト値として
// getLlmProvider()を"呼び出さず関数のまま"渡しているのはこのため（importした瞬間に
// Vertex AIの設定チェックが走ってLLM_PROVIDER=mockの起動を壊さないようにするため）。
// テスト時はここにフェイクのLlmProviderを返す関数を渡せる。
export function createVertexArticleAnalysisService(
  getProvider: () => LlmProvider = getLlmProvider,
): ArticleAnalysisService {
  return {
    async analyze(input) {
      const provider = getProvider();
      const providerName = process.env.LLM_PROVIDER ?? "vertex";
      const model = process.env.GEMINI_MODEL ?? "(unset)";
      const startedAt = Date.now();

      console.log("[ArticleAnalysis] start", { provider: providerName, model, url: input.url });

      const first = await requestOnce(provider, input);
      if (first.success) {
        console.log("[ArticleAnalysis] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: false,
        });
        return first.data;
      }

      console.error("[ArticleAnalysis] validation failed, retrying once", {
        provider: providerName,
        model,
        issue: first.issue,
      });

      const retry = await requestOnce(provider, input, RETRY_INSTRUCTION);
      if (retry.success) {
        console.log("[ArticleAnalysis] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: true,
        });
        return retry.data;
      }

      console.error("[ArticleAnalysis] failed after retry", {
        provider: providerName,
        model,
        durationMs: Date.now() - startedAt,
        issue: retry.issue,
      });
      throw new LlmProviderError(
        `Article Analysisの生成結果がschemaに適合しませんでした: ${retry.issue}`,
        "empty_response",
      );
    },
  };
}

export const vertexArticleAnalysisService: ArticleAnalysisService = createVertexArticleAnalysisService();
