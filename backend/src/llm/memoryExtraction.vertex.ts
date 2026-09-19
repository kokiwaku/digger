import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  memoryExtractionDraftSchema,
  memoryExtractionResultSchema,
  type MemoryExtractionDraft,
  type MemoryExtractionInput,
  type MemoryExtractionResult,
  type MemoryExtractionService,
} from "./memoryExtraction.js";
import { getLlmProvider } from "./provider/llmProviderFactory.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import { extractJsonText } from "./jsonExtraction.js";
import type { LlmProvider } from "./provider/llmProvider.js";

const MAX_CONVERSATION_TURNS = 30;

const memoryExtractionJsonSchema = z.toJSONSchema(memoryExtractionDraftSchema);

const SYSTEM_PROMPT = `あなたはDiggerのMemory Extractionエンジンです。

Diggerは、「気になったことを掘り、理解を蓄積し、次の理解につなげるサービス」です。
Diggerで残したいのは、単なる「知識」だけではありません。ユーザーが会話を通して、
何を理解したか・何を大事だと思ったか・何を候補にしたか・何を決めたか・何がまだ分からないか、
そのすべてがユーザーの現在の理解・判断状態の一部です。

あなたの役割は、会話から保存候補を勝手に確定することではありません。
会話の中でユーザーが残したいと思う可能性がある内容を「候補」として抽出してください。
最終的に何を残すかは、常にユーザー自身が選び、編集し、必要なら自分で追加します。

候補には次の5種類があります。厳密に区別してください:

- knowledge: ユーザーが理解した事実・概念。
  例:「SUVは一般にミニバンより重心が低く、揺れを感じにくい傾向がある」
- preference: ユーザー自身の条件・好み・重視点。
  例:「子供2人が酔いづらいことを重視する」「国産車を優先したい」
- candidate: ユーザーが検討している具体的な対象。
  例:「トヨタ RAV4」
- decision: ユーザーが会話中に決めたこと。
  例:「次はRAV4とフォレスターを比較する」
- open_question: まだ結論が出ていない疑問・確認したいこと。
  例:「フォレスターとRAV4では、どちらが車酔いしにくいか確認したい」

knowledgeとpreferenceを混同しないでください。
- 「国産SUVはアフターサービス面で安心感がある」は一般的な事実の理解なので knowledge。
- 「自分は国産SUVを優先したい」はユーザー自身の価値基準なので preference。

厳守事項:
- 記事本文に書いてあるだけで、ユーザーが実際に触れていない内容をknowledgeとして扱わないでください。
- ユーザーが質問しただけの内容（まだ答えを得ていない）をknowledgeとして扱わないでください。
- **preference / candidate / decision は、AIが勝手に推測してはいけません。**
  AIが「RAV4がおすすめです」と回答しただけでは、RAV4をcandidateとして抽出しないでください。
  ユーザー自身が「RAV4良さそう」「候補に入れたい」「RAV4とフォレスターで迷う」のように
  実際に発言した場合にのみ、candidateとして抽出してください。
  preference・decisionも同様に、ユーザー自身の発言（希望・条件・決定）を根拠にしてください。
- candidateのmetadata.reasons/concernsは、会話中で実際に挙がった理由・懸念のみを使い、
  AIが理由を捏造しないでください。会話に理由が無ければreasons/concernsは省略してください。
- 会話から残したい内容が見つからない場合は、候補を無理に作らず空配列を返してください。
- 知識(knowledge)は、今後別の会話でも再利用できる、小さな理解単位として記述してください
  （悪い例:「政策金利とは金利である」、良い例:「中央銀行が政策金利を変更すると、市場金利や銀行の貸出金利にも影響が波及しうる」）。

confidenceの付け方:
- knowledgeは、ユーザーが自分の言葉で言い換えたり関連づけたりしていればhigh。
- preference/decisionは、ユーザーが明示的に発言していればhigh寄りにしてよい
  （推測でしか言えない場合はlowまたは候補にしない）。
- candidateは、ユーザー自身が候補として言及していればhigh、AIの提案にユーザーが弱く反応した程度ならlow。

knowledgeについてのみ、既存Knowledgeとの関係（relationToExisting）を判定してください。
- "reinforces": 既存Knowledgeとほぼ同じ理解を、別の文脈から再確認・強化しているだけ。
- "extends": 既存Knowledgeを前提として、さらに理解が広がっている。
- "supersedes": 既存Knowledgeの内容が不正確または古く、今回の理解でより正確に置き換えるべき。
- 該当する場合は対応する既存Knowledgeの[id]をknowledgeIdに設定し、reasonに短い理由を書いてください。
- 関連がなければrelationToExisting自体を省略してください。preference/candidate/decision/open_questionには設定しないでください。

出力は指定されたJSON schemaに厳密に従ってください。`;

function truncateConversation(conversation: MemoryExtractionInput["conversation"]): MemoryExtractionInput["conversation"] {
  if (conversation.length <= MAX_CONVERSATION_TURNS) return conversation;
  return conversation.slice(conversation.length - MAX_CONVERSATION_TURNS);
}

function formatConversation(conversation: MemoryExtractionInput["conversation"]): string {
  if (conversation.length === 0) return "（この記事についてまだ深掘りの会話はありません）";
  return conversation.map((turn) => `${turn.role === "user" ? "ユーザー" : "Digger"}: ${turn.content}`).join("\n");
}

function formatExistingKnowledge(existingKnowledge: MemoryExtractionInput["existingKnowledge"]): string {
  if (!existingKnowledge || existingKnowledge.length === 0) {
    return "（このユーザーが過去に保存した理解はまだありません）";
  }
  return existingKnowledge.map((k) => `- [id: ${k.id}] ${k.concept}: ${k.statement}`).join("\n");
}

function formatSourceInfo(source: MemoryExtractionInput["source"]): string {
  if (source.type === "web_article") {
    return `タイトル: ${source.title}\nURL: ${source.url}`;
  }
  if (source.type === "concept_dig" || source.type === "topic_dig") {
    const kind = source.type === "concept_dig" ? "Concept" : "Topic";
    return `入力元: 「${source.title ?? "(不明)"}」という${kind}を起点に、自分の理解からさらに掘ったセッション`;
  }
  const label = source.type === "text" ? "テキスト入力" : "画像入力";
  return `入力元: ${source.title ?? label}`;
}

function buildPrompt(input: MemoryExtractionInput, extraInstruction?: string): string {
  const conversation = truncateConversation(input.conversation);

  const base = `以下の記事とDeep Dive会話から、ユーザーが今回残したいと考えられる内容の保存候補を抽出してください。

# 記事情報
${formatSourceInfo(input.source)}
記事の要約: ${input.articleAnalysis.summary}

# 記事の前提知識（参考。これ自体を理解済みとして扱わないこと）
${input.articleAnalysis.concepts.map((c) => `- ${c.name}: ${c.description}`).join("\n") || "（なし）"}

# Deep Dive会話ログ
${formatConversation(conversation)}

# このユーザーが過去に保存した理解（[id]付き。knowledgeの重複判定・relationToExisting判定に使う）
${formatExistingKnowledge(input.existingKnowledge)}

# 出力ルール
- candidates: 0〜8件程度。無理に件数を埋めない。
- type: knowledge / preference / candidate / decision / open_question のいずれか。
- title: knowledge/candidateは短い名詞句（例:「政策金利」「トヨタ RAV4」）。preference/decision/open_questionは省略可。
- content: 会話を通してユーザーが残したいと考えられる内容を1文で。
- reason: なぜこの候補にしたか、会話中の具体的な根拠を短く記録する（ユーザーには常時表示されない内部情報）。
- metadata: candidateの場合のみ、会話で実際に挙がった理由(reasons)・懸念(concerns)があれば配列で。無ければ省略。
- confidence: 上記の付け方に従う。
- relationToExisting: knowledgeの場合のみ、既存Knowledgeと関連があれば設定する。

指定されたJSON schemaに厳密に従ってJSON形式のみで出力してください。`;

  return extraInstruction ? `${base}\n\n${extraInstruction}` : base;
}

const RETRY_INSTRUCTION = "前回の出力がschemaに適合しなかったため、指定schemaに厳密に従って再生成してください。";

async function requestOnce(provider: LlmProvider, input: MemoryExtractionInput, extraInstruction?: string) {
  const text = await provider.generateText({
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(input, extraInstruction),
    responseJsonSchema: memoryExtractionJsonSchema,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonText(text));
  } catch (err) {
    return { success: false as const, issue: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const result = memoryExtractionDraftSchema.safeParse(parsedJson);
  if (!result.success) {
    return { success: false as const, issue: `schema validation failed: ${result.error.message}` };
  }

  return { success: true as const, data: result.data };
}

function withGeneratedIds(draft: MemoryExtractionDraft): MemoryExtractionResult {
  const result = {
    candidates: draft.candidates.map((candidate) => ({ ...candidate, id: randomUUID() })),
  };
  return memoryExtractionResultSchema.parse(result);
}

export function createVertexMemoryExtractionService(
  getProvider: () => LlmProvider = getLlmProvider,
): MemoryExtractionService {
  return {
    async extract(input) {
      const provider = getProvider();
      const providerName = process.env.LLM_PROVIDER ?? "vertex";
      const model = process.env.GEMINI_MODEL ?? "(unset)";
      const startedAt = Date.now();

      console.log("[MemoryExtraction] start", {
        provider: providerName,
        model,
        sourceType: input.source.type,
        conversationLength: input.conversation.length,
      });

      const first = await requestOnce(provider, input);
      if (first.success) {
        console.log("[MemoryExtraction] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: false,
          candidateCount: first.data.candidates.length,
        });
        return withGeneratedIds(first.data);
      }

      console.error("[MemoryExtraction] validation failed, retrying once", {
        provider: providerName,
        model,
        issue: first.issue,
      });

      const retry = await requestOnce(provider, input, RETRY_INSTRUCTION);
      if (retry.success) {
        console.log("[MemoryExtraction] success", {
          provider: providerName,
          model,
          durationMs: Date.now() - startedAt,
          retried: true,
          candidateCount: retry.data.candidates.length,
        });
        return withGeneratedIds(retry.data);
      }

      console.error("[MemoryExtraction] failed after retry", {
        provider: providerName,
        model,
        durationMs: Date.now() - startedAt,
        issue: retry.issue,
      });
      throw new LlmProviderError(`Memory Extractionの生成結果がschemaに適合しませんでした: ${retry.issue}`, "empty_response");
    },
  };
}

export const vertexMemoryExtractionService: MemoryExtractionService = createVertexMemoryExtractionService();
