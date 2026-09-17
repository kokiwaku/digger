import { deepDiveInputSchema, type DeepDiveInput, type DeepDiveResponse } from "./llm/deepDive.js";
import { getDeepDiveService } from "./llm/deepDiveFactory.js";
import { hybridKnowledgeRetrievalService } from "./llm/knowledgeRetrieval.js";
import { getKnowledgeForDeepDive, toUserKnowledge } from "./knowledge.js";
import type { UserKnowledge } from "./llm/personalizedAnalysis.js";

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

// resolveUserKnowledgeを注入可能にしているのは、articleAnalysis.vertex.ts等のgetProvider
// 注入と同じ理由（テストで実際のMongoDB接続を発生させないため）。
export function createBuildDeepDiveResponse(
  resolveUserKnowledge: (input: DeepDiveInput) => Promise<UserKnowledge[] | undefined> = defaultResolveUserKnowledge,
) {
  return async function buildDeepDiveResponse(input: DeepDiveInput): Promise<DeepDiveResponse> {
    const userKnowledge = input.userKnowledge ?? (await resolveUserKnowledge(input));
    return getDeepDiveService().ask({ ...input, userKnowledge });
  };
}

export const buildDeepDiveResponse = createBuildDeepDiveResponse();
