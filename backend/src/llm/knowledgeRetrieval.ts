import { z } from "zod";
import type { ArticleAnalysis } from "./articleAnalysis.js";
import type { UserKnowledge } from "./personalizedAnalysis.js";
import { getLlmProvider } from "./provider/llmProviderFactory.js";
import { extractJsonText } from "./jsonExtraction.js";
import type { LlmProvider } from "./provider/llmProvider.js";

// Deep Diveへ渡すKnowledgeを絞り込む処理。「毎回全Knowledgeを無条件にLLMへ送る」ことを
// 避けるための独立した責務。将来Embedding/Vector Searchベースの実装に差し替える場合も、
// このinterfaceを実装するファイルを追加し、呼び出し側（deepDive.ts）の依存を差し替える
// だけで済む構造にしている。

export interface KnowledgeRetrievalInput {
  question: string;
  articleAnalysis: ArticleAnalysis;
  // 呼び出し側で既にstatus（active/foundationalのみ等）を絞り込んだ上で渡す想定。
  knowledge: UserKnowledge[];
}

export interface KnowledgeRetrievalService {
  retrieve(input: KnowledgeRetrievalInput): Promise<UserKnowledge[]>;
}

// MVPでは3〜5件程度に絞る（過剰にコンテキストを膨らませないため）。
const MAX_RELEVANT_KNOWLEDGE = 5;
const MIN_TOKEN_LENGTH = 2;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

// Embedding/Vector Searchは使わず、concept/statementとquestion・articleAnalysisの
// 単純な文字列一致でスコアリングする（MVP）。日本語のconcept（例:「政策金利」）は
// 短い名詞句であることが多く、questionや記事の説明文への部分一致がそのまま強いシグナルになる。
function scoreKnowledge(knowledge: UserKnowledge, input: KnowledgeRetrievalInput): number {
  let score = 0;
  const { question, articleAnalysis } = input;
  const concept = knowledge.concept.trim();

  if (concept.length > 0 && question.includes(concept)) {
    score += 3;
  }

  for (const articleConcept of articleAnalysis.concepts) {
    if (concept.length > 0 && (articleConcept.name.includes(concept) || concept.includes(articleConcept.name))) {
      score += 2;
    }
    if (concept.length > 0 && articleConcept.description.includes(concept)) {
      score += 1;
    }
  }

  const questionTokens = new Set(tokenize(question));
  if (questionTokens.size > 0) {
    const statementTokens = tokenize(knowledge.statement);
    for (const token of statementTokens) {
      if (questionTokens.has(token)) score += 1;
    }
  }

  return score;
}

// キーワード一致ベースの実装。スコア0（無関係）のKnowledgeは選ばず、
// スコアが高い順に最大MAX_RELEVANT_KNOWLEDGE件だけを返す。
export const keywordKnowledgeRetrievalService: KnowledgeRetrievalService = {
  async retrieve(input) {
    const scored = input.knowledge
      .map((knowledge) => ({ knowledge, score: scoreKnowledge(knowledge, input) }))
      .filter((entry) => entry.score > 0);

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, MAX_RELEVANT_KNOWLEDGE).map((entry) => entry.knowledge);
  },
};

// キーワード一致では拾えない言い換え（例:「利上げ」⇔「政策金利」）を補うためのLLMフォールバック。
// キーワード一致が1件も見つからなかった場合のみ実行する（毎回全KnowledgeをLLMへ送ることは避ける）。
// 失敗時は例外を投げず空配列に落とす（Relevant Knowledgeはあくまで補助情報のため、
// 取得に失敗してもDeep Dive自体は通常どおり進める）。1回のみ呼び出し、再試行はしない
// （structured outputのvalidationに失敗しても「関連Knowledgeなし」として扱えば十分なため）。
const llmSelectionSchema = z.object({ relevantIds: z.array(z.string()) });
const llmSelectionJsonSchema = z.toJSONSchema(llmSelectionSchema);

function buildSelectionPrompt(input: KnowledgeRetrievalInput): string {
  const list = input.knowledge.map((k) => `- [id: ${k.id}] ${k.concept}: ${k.statement}`).join("\n");

  return `以下は、このユーザーが過去に保存した理解の一覧です。

${list}

# 記事の要約
${input.articleAnalysis.summary}

# 今回の質問
${input.question}

上記のうち、今回の質問や記事を理解する上で関連性が高いものだけを最大${MAX_RELEVANT_KNOWLEDGE}件選び、そのidの配列を返してください。表現が違うだけで意味的に関連する場合（例:「利上げ」と「政策金利」）も選んでください。関連するものが無ければ空配列を返してください。無理に選ばないでください。
指定されたJSON schemaに厳密に従ってJSON形式のみで出力してください。`;
}

async function selectRelevantWithLlm(
  input: KnowledgeRetrievalInput,
  provider: LlmProvider,
): Promise<UserKnowledge[]> {
  try {
    const text = await provider.generateText({
      prompt: buildSelectionPrompt(input),
      responseJsonSchema: llmSelectionJsonSchema,
    });
    const parsed = llmSelectionSchema.safeParse(JSON.parse(extractJsonText(text)));
    if (!parsed.success) return [];

    const relevantIds = new Set(parsed.data.relevantIds);
    return input.knowledge.filter((k) => relevantIds.has(k.id)).slice(0, MAX_RELEVANT_KNOWLEDGE);
  } catch (err) {
    console.error("[KnowledgeRetrieval] LLM-based fallback selection failed, continuing without it", err);
    return [];
  }
}

// キーワード一致を優先し（LLM呼び出し不要で速い）、1件もヒットしなかった場合のみ
// LLMに選定を任せる（言い換えによる意味的なつながりを補うため）。
// getProviderの遅延解決はArticle Analysis等と同じ理由（LLM_PROVIDER=mockでの起動を壊さず、
// テストではフェイクのLlmProviderを注入できるようにするため）。
export function createHybridKnowledgeRetrievalService(
  getProvider: () => LlmProvider = getLlmProvider,
): KnowledgeRetrievalService {
  return {
    async retrieve(input) {
      const keywordResult = await keywordKnowledgeRetrievalService.retrieve(input);
      if (keywordResult.length > 0) return keywordResult;
      if (input.knowledge.length === 0) return [];

      return selectRelevantWithLlm(input, getProvider());
    },
  };
}

export const hybridKnowledgeRetrievalService: KnowledgeRetrievalService =
  createHybridKnowledgeRetrievalService();
