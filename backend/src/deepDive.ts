import { deepDiveInputSchema, type DeepDiveInput, type DeepDiveMemoryItem, type DeepDiveResponse } from "./llm/deepDive.js";
import { getDeepDiveService } from "./llm/deepDiveFactory.js";
import { hybridKnowledgeRetrievalService } from "./llm/knowledgeRetrieval.js";
import { getKnowledgeForDeepDive, toUserKnowledge } from "./knowledge.js";
import { getUserMemoryItems } from "./memoryItem.js";
import type { UserKnowledge } from "./llm/personalizedAnalysis.js";

// 保存済みMemory（preference/candidate/decision/open_question）のうち、Deep Diveへ渡す件数の
// 上限。Knowledgeのような文字列一致ベースの関連度スコアリングまでは行わず（#5「無理に使わない」
// はprompt側の指示に委ね、backend側は無条件に絞り込み過ぎない）、直近作成された順に一定件数
// だけを渡す単純な方式にする。これらは母数がKnowledgeよりずっと小さく、かつ「今まさに検討中の
// 対象」であることが多いため、直近優先という単純な基準でも十分に有用な文脈になる。
const MAX_RELEVANT_MEMORY_ITEMS = 10;

export function parseDeepDiveInput(body: unknown): DeepDiveInput {
  const result = deepDiveInputSchema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "invalid request");
  }
  return result.data;
}

// クライアントからuserKnowledgeが明示的に渡されなかった場合、保存済みKnowledge
// （status: active/foundationalのみ）の中から今回の質問・記事に関連しそうなものだけを選んで
// Deep Diveへ渡す。取得・選定に失敗しても深掘り自体は継続する（Knowledgeなしの従来動作）。
export async function defaultResolveUserKnowledge(input: DeepDiveInput): Promise<UserKnowledge[] | undefined> {
  try {
    const docs = await getKnowledgeForDeepDive();
    if (docs.length === 0) return undefined;

    const candidates = docs.map(toUserKnowledge);
    const relevant = await hybridKnowledgeRetrievalService.retrieve({
      question: input.question,
      articleAnalysis: input.articleAnalysis,
      knowledge: candidates,
    });

    return relevant.length > 0 ? relevant : undefined;
  } catch (err) {
    console.error("[deepDive] failed to resolve relevant knowledge, continuing without it", err);
    return undefined;
  }
}

// クライアントからrelevantMemoryが明示的に渡されなかった場合、保存済みMemory
// （knowledge以外、status: activeのみ）のうち直近のものをDeep Diveへ渡す。
// 取得に失敗しても深掘り自体は継続する（Memoryなしの従来動作）。
export async function defaultResolveRelevantMemory(): Promise<DeepDiveMemoryItem[] | undefined> {
  try {
    const docs = await getUserMemoryItems();
    const relevant = docs
      .filter((doc) => doc.status === "active" && doc.type !== "knowledge")
      .slice(0, MAX_RELEVANT_MEMORY_ITEMS)
      .map((doc) => ({
        type: doc.type as "preference" | "candidate" | "decision" | "open_question",
        title: doc.title,
        content: doc.content,
        metadata: doc.metadata,
      }));

    return relevant.length > 0 ? relevant : undefined;
  } catch (err) {
    console.error("[deepDive] failed to resolve relevant memory, continuing without it", err);
    return undefined;
  }
}

// resolveUserKnowledge/resolveRelevantMemoryを注入可能にしているのは、articleAnalysis.vertex.ts
// 等のgetProvider注入と同じ理由（テストで実際のMongoDB接続を発生させないため）。
export function createBuildDeepDiveResponse(
  resolveUserKnowledge: (input: DeepDiveInput) => Promise<UserKnowledge[] | undefined> = defaultResolveUserKnowledge,
  resolveRelevantMemory: (input: DeepDiveInput) => Promise<DeepDiveMemoryItem[] | undefined> = defaultResolveRelevantMemory,
) {
  return async function buildDeepDiveResponse(input: DeepDiveInput): Promise<DeepDiveResponse> {
    const userKnowledge = input.userKnowledge ?? (await resolveUserKnowledge(input));
    const relevantMemory = input.relevantMemory ?? (await resolveRelevantMemory(input));
    return getDeepDiveService().ask({ ...input, userKnowledge, relevantMemory });
  };
}

export const buildDeepDiveResponse = createBuildDeepDiveResponse();
