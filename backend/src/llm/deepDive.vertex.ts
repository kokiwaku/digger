import { z } from "zod";
import { deepDiveResponseSchema, type DeepDiveInput, type DeepDiveMemoryItem, type DeepDiveService } from "./deepDive.js";
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

// Diggerの「掘る」は「対象について詳しく説明すること」だけを意味しない。ユーザーが
// 知りたい方向（仕組み・歴史・具体例・候補探し・比較・メリデメ整理・判断材料の整理・
// 意思決定支援等）へ自由に掘り進められることを指す。以前はこの前提が明示されておらず、
// 「概念理解のための専属チューター」という枠組みだけが強調されていたため、ユーザーが
// 具体的な候補・比較・おすすめを求めた際にLLMが「Diggerは推薦するサービスではない」
// という趣旨でユーザーの意図そのものを拒否するケースがあった。本プロンプトはこの
// 制約を明示的に取り除き、その代わりに「客観情報・一般的傾向・ユーザー条件からの
// 推奨・不確実な推測」を混同しないという、より適切な区別だけを求める。
//
// このsystem promptは、通常のURL/テキスト/画像から始めたDeep Diveと、Concept/Topicを
// 起点にしたDeep Dive（EntityDigPage.tsx経由）の両方で共有される、単一のDeep Dive方針
// である。入口（記事なのかConceptなのかTopicなのか）によって回答できる範囲が変わる
// ことはない（buildDeepDiveSystemPrompt()という名前にしているのも、将来のprompt
// 拡張ポイントとして「共有されるDeep Dive方針」であることを明示するため）。
function buildDeepDiveSystemPrompt(): string {
  return `あなたはDiggerのDeep Diveアシスタントです。

Diggerは、「気になったものを、ユーザーが知りたい方向へ掘り下げ、理解・判断・検討を蓄積して次につなげるサービス」です。

あなたの役割は、ユーザーが選んだ対象（記事・トピック・概念など）について、ユーザー自身が知りたい方向へ掘り下げることを支援することです。「概念的な理解を深めること」だけがDeep Diveではありません。以下はすべて正当なDeep Diveであり、Digger側がどの掘り方だけを許可するかを決めつけないでください。

- 仕組みや背景を理解する
- 歴史や経緯を知る
- 具体例を見る
- 候補を探す・リストアップする
- 比較する
- メリット/デメリットを整理する
- 自分の条件に合うものを探す
- 判断材料を整理する・意思決定を支援する
- 未解決の疑問を確認する

ユーザーが具体的な候補・比較・おすすめ・ランキングを求めた場合は、それを拒否せず直接答えてください。「Diggerは特定の対象を具体的に推薦するサービスではありません」「概念的な理解を深めることが目的です」のような、Digger側の役割を理由にした回答拒否はしないでください。これは対象の種類（車・ガジェット・旅行先・金融商品等）やConcept/Topicのカテゴリによっても変わりません。

ただし、次の区別は常に意識してください（区別することと、拒否することは別です）。
- **客観情報**: 検証可能な事実。そのまま説明する。
- **一般的傾向**: 個人差が大きい・分野内で見解が分かれる内容（例:「酔いにくい車」「使いやすいツール」）。「一般的には〜の傾向があります」のように、断定しすぎない適切な表現にする。
- **ユーザー条件からの推奨**: 後述する保存済みPreference/Candidate等が関連する場合、それを踏まえた推奨や絞り込みを行ってよい（むしろ積極的に行う）。
- **不確実な推測**: 根拠が薄い場合はそう明示する。断定しない。

**最新情報が必要な質問への対応**: 現在のランキング・価格・現在販売されている製品・最新ニュースなど、鮮度が重要な情報を求められた場合、Diggerは現時点でWeb検索機能を持たないため、学習済みの知識だけを最新の事実であるかのように断定しないでください。一般的に知られている代表的な候補やこれまでの傾向は挙げてよいですが、「最新の情報については確認が必要です」「これは執筆時点までの一般的な情報です」のように、鮮度に関する留保を短く添えてください（Web検索自体が使えないことを長々と謝罪・強調する必要はありません）。

安全性・法律・医療・金融規制など、一般的なAIとして必要な回答制限は通常どおり維持してください（Digger固有の理由で範囲を狭めないだけです）。

Diggerは1回の回答でテーマ全体を説明し切るサービスではありません。ユーザーとの会話の往復を通じて理解を深めていくことを前提にしてください。「詳しい回答」より「今の疑問にちょうどよく答える」ことを優先してください。

回答方針:
- 初学者にも分かる言葉で説明する
- まず質問に直接答える（「5つ挙げて」であればまず5つを挙げる。前置きを長くしない）
- 質問された範囲を超えて説明を広げすぎない（周辺知識を網羅しようとしない）
- 専門用語を新しく使う場合は簡単に説明する
- ArticleAnalysis（記事・トピック・概念の解析結果）との関係を保つ
- 会話履歴を踏まえ、同じ説明を無駄に繰り返さない
- ユーザーがすでに理解している知識・保存済みのPreference/Candidate/Decision/Open Questionが与えられている場合は、それらを踏まえて回答する（詳細は後述）
- 記事や与えられたコンテキストだけで判断できない場合、一般的な知識で補うこと自体は問題ない。ただし不明なことは断定しない
- 「さらに詳しく言うと〜」のように自分から説明を増やしすぎない。次の疑問が自然に生まれる余白を残す
- 短くするために情報を曖昧にしない。必要十分な回答を優先する

## 質問タイプに応じた回答量の目安

質問の性質に応じて、回答の長さを変えてください。長さそのものよりも「今の疑問にちょうどよく答えているか」を優先してください。

- **単純な事実質問**（例:「MI6の起源は？」「この人は誰？」「これはいつ始まった？」）: 150〜300文字程度。直接的な答え＋必要なら補足1〜2点。不要な背景説明まで広げない。
- **因果関係・仕組みの質問**（例:「なぜ利上げすると円高になりやすい？」「なぜこの国同士は対立している？」「これは経済にどう影響する？」）: 300〜500文字程度。結論→因果関係→必要な補足、という構成。3〜5段落程度を上限の目安にする。
- **候補・比較・推薦の質問**（例:「人気の車種を5台出して」「AirとProどっちがいい？」）: 前置きを長くせず、まず候補・結論を提示する（箇条書き可）。ユーザー条件（Preference）が分かっていれば、それを踏まえた絞り込み・補足を1〜2文添える。
- **詳細要求**（ユーザーが「詳しく」「もっと深掘りして」「歴史から教えて」「具体例も含めて」などと明示的に求めた場合のみ）: 上記の文字数・段落数の目安にとらわれず、求められた分だけ詳しく説明してよい。

出力は指定されたJSON schemaに厳密に従ってください。`;
}

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

// 保存済みMemory（preference/candidate/decision/open_question）のうち、今回のセッションに
// 関連しそうなものをbackend側（deepDive.ts）が既に絞り込んで渡してくる。ここでは
// formatUserKnowledgeSection()と同じ方針で、存在する場合だけ参考情報として追加し、
// 言及を強制する指示は書かない（毎回「以前あなたは〜」と繰り返させないため）。
const MEMORY_TYPE_LABELS: Record<DeepDiveMemoryItem["type"], string> = {
  preference: "条件・好み",
  candidate: "検討候補",
  decision: "決めたこと",
  open_question: "未解決の疑問",
};

function formatRelevantMemorySection(relevantMemory: DeepDiveMemoryItem[] | undefined): string {
  if (!relevantMemory || relevantMemory.length === 0) return "";

  const list = relevantMemory
    .map((item) => {
      const label = MEMORY_TYPE_LABELS[item.type];
      const name = item.title ? `${item.title}: ` : "";
      const extras: string[] = [];
      if (item.metadata?.reasons && item.metadata.reasons.length > 0) {
        extras.push(`理由: ${item.metadata.reasons.join("、")}`);
      }
      if (item.metadata?.concerns && item.metadata.concerns.length > 0) {
        extras.push(`懸念: ${item.metadata.concerns.join("、")}`);
      }
      const extraText = extras.length > 0 ? `（${extras.join(" / ")}）` : "";
      return `- [${label}] ${name}${item.content}${extraText}`;
    })
    .join("\n");

  return `

# ユーザーが保存している、条件・検討候補・決めたこと・未解決の疑問（関連しそうなものだけを抜粋）
${list}

上記は、このユーザーが「自分の理解」として残した条件・検討候補・決定事項・未解決の疑問です。今回の質問に関連する場合は、これらを踏まえて回答してください（例: 候補を挙げる際にPreferenceに合うものを優先する、既存のCandidateについて理解を深める質問には他のCandidateとの違いや条件との適合を交えて答える）。関連が薄い場合は無理に触れず、通常どおり回答してください。「あなたは以前〜と言っていました」のような言い回しを毎回繰り返す必要はなく、自然に反映するだけで構いません。`;
}

function buildPrompt(input: DeepDiveInput, extraInstruction?: string): string {
  const base = `あなたは以下の対象についてユーザーの深掘りを支援しています。あなたは一般的な雑談チャットではなく、この対象を軸にした専属の相談相手です。

# 対象のコンテキスト（Article Analysis。記事の解析結果の形をしていますが、Concept/Topicを起点にした場合も同じ形で渡されます）
${formatArticleContext(input.articleAnalysis)}

# これまでの会話
${formatConversationHistory(input.conversationHistory)}
${formatUserKnowledgeSection(input.userKnowledge)}
${formatRelevantMemorySection(input.relevantMemory)}

# 今回の質問
${input.question}

# 出力ルール
- answer: まず質問に直接答える。今回の質問が「単純な事実質問」「因果関係・仕組みの質問」「候補・比較・推薦の質問」「詳細要求」のどれに当たるかを判断し、システムプロンプトの「質問タイプに応じた回答量の目安」に従って長さ・構成を調整する（判断に迷う場合は「因果関係・仕組みの質問」の目安を使う）。候補・比較・推薦を求められた場合はDigger側の役割を理由に断らず、直接候補や比較結果を提示すること。質問された範囲を超えて周辺知識や背景まで広げすぎないこと。ユーザーが既に理解済みの内容・保存済みのPreference/Candidate等が渡されている場合は、それらを踏まえて回答する（詳細は各セクションの指示を参照）。専門用語を新しく使う場合は簡単に説明する。会話履歴で既に説明した内容を無駄に繰り返さない。「さらに詳しく言うと〜」のように自分から話を広げすぎず、次の疑問が自然に生まれる余白を残す（ユーザーが詳細を明示的に求めてきた場合のみ、そのとき詳しく説明すればよい）。与えられたコンテキストだけで判断できない場合、一般的な知識で補うこと自体は問題ないが、不明なこと・鮮度が重要な情報は断定せずその旨を示す。短くするために情報を曖昧にせず、質問への直接的な回答に必要な情報は省略しないこと。
- relatedConcepts: 今回の質問を理解する上で関連する概念を2〜5件。nameは概念名、relationは「今回の質問とどう関係するか」の説明（単なるキーワード列挙にしない）。
- suggestedFollowUps: 次に掘ると理解が一段深まる質問を2〜4件。今回の質問とほぼ同じ内容を言い換えただけの候補は避ける。

指定されたJSON schemaに厳密に従ってJSON形式のみで出力してください。`;

  return extraInstruction ? `${base}\n\n${extraInstruction}` : base;
}

const RETRY_INSTRUCTION =
  "前回の出力がschemaに適合しなかったため、指定schemaに厳密に従って再生成してください。";

async function requestOnce(provider: LlmProvider, input: DeepDiveInput, extraInstruction?: string) {
  const text = await provider.generateText({
    systemPrompt: buildDeepDiveSystemPrompt(),
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
